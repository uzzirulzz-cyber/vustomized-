"use client";

// WhatsApp-style message box shared by the Dialer and the Inbox.
// Everything happens INSIDE the CRM: sends go through the Meta WhatsApp
// Cloud API and every bubble records the provider's true result. No device
// hand-offs, no external links.
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/lp/api";
import { cn } from "@/lib/utils";

export type ChatMsg = {
  id: string; direction: string; kind: string; body: string;
  status: string; errorMessage: string | null; createdAt: string; campaignId?: string | null;
};
export type ChatConv = {
  id: string; waPhone: string | null; waServiceWindowUntil: string | null; unreadCount?: number;
  leadId?: string; lead?: unknown; // full lead object rides along from GET /conversations/[id]
  assignedTo?: { id: string; name: string } | null;
};
export type ChatDetail = { conversation: ChatConv; messages: ChatMsg[]; waConnected: boolean };
export type ChatTemplate = { id: string; name: string; language: string; bodyText: string; kind: string; approvalStatus: string };

// Meta maps template body parameters BY POSITION — list each placeholder
// occurrence ({{1}}, {{first_name}} …) with a snippet of surrounding text.
export function templatePlaceholders(bodyText: string): { token: string; snippet: string }[] {
  const out: { token: string; snippet: string }[] = [];
  for (const m of bodyText.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) {
    const start = Math.max(0, (m.index ?? 0) - 22);
    const end = Math.min(bodyText.length, (m.index ?? 0) + m[0].length + 22);
    out.push({ token: m[1], snippet: `${start > 0 ? "…" : ""}${bodyText.slice(start, end).replace(/\s+/g, " ")}${end < bodyText.length ? "…" : ""}` });
  }
  return out;
}

function hasNumericPlaceholder(bodyText: string): boolean {
  for (const m of bodyText.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) if (/^\d+$/.test(m[1])) return true;
  return false;
}

// ── tiny inline icons ────────────────────────────────────────────────────────
const TICK_COLOR = { read: "#53bdeb", delivered: "#667781", sent: "#667781" };
function Ticks({ status }: { status: string }) {
  if (status === "queued") return <svg width="15" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="#667781" strokeWidth="1.4" /><path d="M8 5v3.4l2 1.2" stroke="#667781" strokeWidth="1.4" strokeLinecap="round" /></svg>;
  if (status === "failed") return <svg width="14" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.2" fill="#e53935" /><path d="M8 4.6v4.2" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" /><circle cx="8" cy="11.2" r="0.9" fill="#fff" /></svg>;
  const color = TICK_COLOR[status as keyof typeof TICK_COLOR] || "#667781";
  if (status === "sent") return <svg width="15" height="12" viewBox="0 0 16 12" fill="none"><path d="M2 6.6 5.4 10 13 2.4" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  return <svg width="17" height="12" viewBox="0 0 18 12" fill="none"><path d="M1.5 6.6 4.8 10 12 2.6" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /><path d="M6.5 6.9 9.3 10 16.5 2.6" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function SendIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z" /></svg>;
}
function TemplateIcon() {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3.5" y="3.5" width="17" height="17" rx="3" /><path d="M3.5 9.5h17M9.5 9.5V20.5" /></svg>;
}
function BackspaceIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M9 5h11a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 20 19H9l-6.2-6.3a1 1 0 0 1 0-1.4L9 5Z" strokeLinejoin="round" /><path d="m12.5 9.5 5 5m0-5-5 5" strokeLinecap="round" /></svg>;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "#";
  return ((parts[0][0] || "") + (parts[1]?.[0] || "")).toUpperCase();
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(Date.now() - 86400000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "TODAY";
  if (same(d, yest)) return "YESTERDAY";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }).toUpperCase();
}

export default function ChatPanel({
  detail, loading, leadName, leadCompany, optedOut,
  onSendText, sending, onSendTemplate, tplSending,
  error, windowClosedHint, className,
}: {
  detail: ChatDetail | null;
  loading?: boolean;
  leadName: string;
  leadCompany?: string;
  optedOut?: boolean;
  onSendText: (body: string) => Promise<void>;
  sending: boolean;
  onSendTemplate: (templateId: string, params: string[]) => Promise<void>;
  tplSending: boolean;
  error?: string;
  windowClosedHint?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState("");
  const [templates, setTemplates] = useState<ChatTemplate[]>([]);
  const [tplOpen, setTplOpen] = useState(false);
  const [tplId, setTplId] = useState("");
  const [params, setParams] = useState<string[]>([]);
  const [tplError, setTplError] = useState("");
  const [chipError, setChipError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Approved templates (Meta-approved only — these deliver business-initiated)
  useEffect(() => {
    api<{ templates: ChatTemplate[] }>("/api/lp/templates")
      .then((d) => setTemplates(d.templates.filter((t) => t.kind === "whatsapp_template" && t.approvalStatus === "meta_approved")))
      .catch(() => setTemplates([]));
  }, []);

  // Reset composer state when the conversation switches
  useEffect(() => { setDraft(""); setTplOpen(false); setTplId(""); setParams([]); setTplError(""); setChipError(""); }, [detail?.conversation.id]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [detail?.messages.length, detail?.conversation.id, loading]);

  const windowOpen = detail?.conversation.waServiceWindowUntil
    ? new Date(detail.conversation.waServiceWindowUntil).getTime() > Date.now()
    : false;

  const picked = templates.find((t) => t.id === tplId) || null;
  const pickedPh = picked ? templatePlaceholders(picked.bodyText) : [];
  const numericMissing = pickedPh.some((p, i) => /^\d+$/.test(p.token) && !(params[i] || "").trim());

  const quickTemplates = templates.filter((t) => !hasNumericPlaceholder(t.bodyText));

  const doSendText = async () => {
    if (!draft.trim() || sending) return;
    const body = draft;
    setDraft("");
    await onSendText(body);
  };
  const doSendTemplate = async () => {
    if (!picked || tplSending) return;
    setTplError("");
    try {
      await onSendTemplate(picked.id, params);
      setTplId(""); setParams([]); setTplOpen(false);
      setChipError("");
    } catch (e) {
      setTplError(e instanceof Error ? e.message : "Template send failed");
    }
  };
  const doQuickSend = async (t: ChatTemplate) => {
    setChipError("");
    try {
      await onSendTemplate(t.id, []);
    } catch (e) {
      setChipError(e instanceof Error ? e.message : "Template send failed");
    }
  };

  const showWindowStrip = (windowClosedHint || (!windowOpen && detail && detail.messages.length >= 0)) && !optedOut && detail !== null;

  return (
    <div className={cn("flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white min-h-0", className)}>
      {/* ── WhatsApp header ── */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-[#f0f2f5] border-b border-[#d1d7db] shrink-0">
        <div className="w-9 h-9 rounded-full bg-[#00a884] text-white text-xs font-bold flex items-center justify-center shrink-0">
          {initialsOf(leadName)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-[#111b21] truncate leading-tight">{leadName}</div>
          <div className="text-[11px] text-[#667781] truncate">
            {detail?.conversation.waPhone || "—"}{leadCompany ? ` · ${leadCompany}` : ""}
          </div>
        </div>
        {detail && (
          <div className="flex items-center gap-1.5 shrink-0">
            <span className={cn("text-[9px] px-2 py-1 rounded-full border font-medium",
              detail.waConnected ? "border-[#00a884]/40 bg-[#00a884]/10 text-[#008069]" : "border-rose-400/40 bg-rose-500/10 text-rose-600")}>
              {detail.waConnected ? "API connected" : "API offline"}
            </span>
            <span className={cn("text-[9px] px-2 py-1 rounded-full border font-medium",
              windowOpen ? "border-[#00a884]/40 bg-[#00a884]/10 text-[#008069]" : "border-amber-400/40 bg-amber-500/10 text-amber-700")}>
              {windowOpen ? "Free-text window OPEN" : "Templates only · 24h"}
            </span>
          </div>
        )}
      </div>

      {/* ── Chat wallpaper ── */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-6 py-4 space-y-1.5"
        style={{
          backgroundColor: "#efeae2",
          backgroundImage: "radial-gradient(rgba(0,0,0,0.035) 1px, transparent 1.4px)",
          backgroundSize: "22px 22px",
        }}
      >
        {loading && <div className="h-full flex items-center justify-center text-xs text-[#667781]">Opening conversation…</div>}
        {!loading && detail && detail.messages.length === 0 && (
          <div className="h-full min-h-40 flex items-center justify-center">
            <div className="bg-[#ffeecd] text-[#54656f] text-[11px] px-4 py-2.5 rounded-lg shadow-sm max-w-md text-center leading-relaxed">
              No messages yet. {windowOpen
                ? "The 24h free-text window is open — type a message below and send."
                : "Meta requires an approved template to start this chat. Pick one below — once the contact replies, free-text unlocks for 24 hours."}
            </div>
          </div>
        )}
        {!loading && detail && detail.messages.map((m, i) => {
          const showDay = i === 0 || dayLabel(detail.messages[i - 1].createdAt) !== dayLabel(m.createdAt);
          const out = m.direction === "outbound";
          return (
            <div key={m.id}>
              {showDay && (
                <div className="flex justify-center my-3">
                  <span className="bg-[#ffffff] text-[#54656f] text-[10px] font-medium px-3 py-1 rounded-lg shadow-sm">{dayLabel(m.createdAt)}</span>
                </div>
              )}
              <div className={cn("flex", out ? "justify-end" : "justify-start")}>
                <div className={cn(
                  "relative max-w-[78%] rounded-lg px-2.5 py-1.5 shadow-sm",
                  out ? "bg-[#d9fdd3] rounded-tr-[2px]" : "bg-white rounded-tl-[2px]",
                  m.status === "failed" && "ring-1 ring-rose-400",
                )}>
                  <div className="text-[13px] leading-snug text-[#111b21] whitespace-pre-wrap break-words pr-14">{m.body}</div>
                  <div className="absolute bottom-1 right-2 flex items-center gap-1">
                    {m.kind === "template" && <span className="text-[9px] text-[#667781] italic">template</span>}
                    <span className="text-[10px] text-[#667781]">{new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    {out && <Ticks status={m.status} />}
                  </div>
                  {m.status === "failed" && m.errorMessage && (
                    <div className="mt-1 pt-1 border-t border-rose-300/60 text-[10px] text-rose-600 flex items-start gap-1">
                      <span className="font-semibold shrink-0">Not delivered:</span>
                      <span className="leading-snug">{m.errorMessage}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Error / notice strips ── */}
      {detail && !optedOut && (error || chipError) && (
        <div className="mx-3 mb-1.5 text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 leading-relaxed">{error || chipError}</div>
      )}

      {/* Template quick-bar (window closed, or after a 131047 rejection) */}
      {detail && !optedOut && showWindowStrip && !windowOpen && (
        <div className="mx-3 mb-1.5 rounded-lg border border-amber-200 bg-[#fffcf0] px-3 py-2">
          <div className="text-[11px] text-amber-800 leading-snug">
            <span className="font-semibold">Meta only delivers free text inside the 24h service window</span> (opened when the contact replies). Approved templates always deliver — tap to send:
          </div>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {quickTemplates.length === 0 && <span className="text-[10px] text-amber-700">No approved templates available — sync them under Templates.</span>}
            {quickTemplates.map((t) => (
              <button key={t.id} disabled={tplSending || sending}
                onClick={() => void doQuickSend(t)}
                className="text-[10px] font-medium px-2.5 py-1 rounded-full border border-[#00a884]/40 bg-[#00a884]/10 text-[#008069] hover:bg-[#00a884]/20 transition disabled:opacity-50">
                {t.name}
              </button>
            ))}
            <button onClick={() => { setTplOpen(true); setTplId(""); }}
              className="text-[10px] font-medium px-2.5 py-1 rounded-full border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 transition">
              More templates…
            </button>
          </div>
        </div>
      )}

      {detail && optedOut && (
        <div className="mx-3 mb-2 text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 text-center">
          This contact is on the suppression list (opted out) — sending is blocked.
        </div>
      )}

      {/* ── Template picker panel ── */}
      {tplOpen && (
        <div className="border-t border-[#d1d7db] bg-white px-3 py-3 max-h-64 overflow-y-auto shrink-0">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold text-[#111b21]">Approved templates (business-initiated)</div>
            <button onClick={() => setTplOpen(false)} className="text-[11px] text-[#008069] hover:underline">Close</button>
          </div>
          {templates.length === 0 && <div className="text-[11px] text-[#667781] py-2">No Meta-approved templates yet — create and sync them under Campaigns → Templates.</div>}
          <div className="space-y-1.5">
            {templates.map((t) => (
              <div key={t.id} className={cn("rounded-lg border transition", tplId === t.id ? "border-[#00a884] bg-[#00a884]/[0.06]" : "border-[#d1d7db] hover:bg-[#f0f2f5]")}>
                <button className="w-full text-left px-3 py-2" onClick={() => { setTplId(tplId === t.id ? "" : t.id); setParams([]); setTplError(""); }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[#111b21]">{t.name}</span>
                    <span className="text-[9px] text-[#667781]">{t.language}</span>
                  </div>
                  <div className="text-[11px] text-[#54656f] truncate mt-0.5">{t.bodyText.replace(/\s+/g, " ").slice(0, 90)}</div>
                </button>
                {tplId === t.id && (
                  <div className="px-3 pb-2.5 space-y-1.5">
                    <div className="text-[10px] whitespace-pre-wrap text-[#54656f] bg-[#f0f2f5] rounded p-2 max-h-20 overflow-y-auto">{t.bodyText}</div>
                    {pickedPh.length > 0 && (
                      <div className="space-y-1">
                        <div className="text-[9px] uppercase tracking-wider text-[#667781]">
                          Fill {pickedPh.filter((p) => /^\d+$/.test(p.token)).length} parameter{pickedPh.filter((p) => /^\d+$/.test(p.token)).length !== 1 ? "s" : ""} — named ones fill automatically from the CRM
                        </div>
                        {pickedPh.map((p, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <span className="text-[9px] font-mono text-[#008069] bg-[#00a884]/10 rounded px-1.5 py-0.5 whitespace-nowrap">{`{{${p.token}}}`}</span>
                            {/^\d+$/.test(p.token) ? (
                              <input
                                value={params[i] || ""}
                                onChange={(e) => setParams((arr) => { const n = [...arr]; n[i] = e.target.value; return n; })}
                                placeholder={p.snippet}
                                className="flex-1 h-7 rounded border border-[#d1d7db] px-2 text-[11px] text-[#111b21] focus:outline-none focus:border-[#00a884]"
                              />
                            ) : (
                              <span className="text-[10px] text-[#667781] italic">auto from CRM · {p.snippet}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {tplError && <div className="text-[10px] text-rose-600 bg-rose-50 border border-rose-200 rounded px-2 py-1">{tplError}</div>}
                    <button
                      onClick={() => void doSendTemplate()}
                      disabled={tplSending || numericMissing}
                      className="w-full h-8 rounded-full bg-[#00a884] hover:bg-[#008069] text-white text-xs font-semibold transition disabled:opacity-50">
                      {tplSending ? "Sending…" : numericMissing ? "Fill the required parameters first" : "Send template"}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Composer ── */}
      {detail && !optedOut && (
        <div className="flex items-center gap-2 px-3 py-2.5 bg-[#f0f2f5] border-t border-[#d1d7db] shrink-0">
          <button
            onClick={() => setTplOpen((v) => !v)}
            title="Templates"
            className={cn("w-10 h-10 rounded-full flex items-center justify-center transition shrink-0",
              tplOpen ? "bg-[#00a884] text-white" : "text-[#54656f] hover:bg-[#e1e4e6]")}>
            <TemplateIcon />
          </button>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void doSendText(); } }}
            placeholder={windowOpen ? "Type a message" : windowClosedHint ? "Free text was rejected — send a template to re-engage" : "Type a message (deliverable once the contact replies)"}
            className="flex-1 h-10 rounded-full bg-white border border-transparent px-4 text-[13px] text-[#111b21] placeholder:text-[#8696a0] focus:outline-none focus:border-[#00a884]/50"
          />
          <button
            onClick={() => void doSendText()}
            disabled={sending || !draft.trim()}
            title="Send"
            className="w-10 h-10 rounded-full bg-[#00a884] hover:bg-[#008069] text-white flex items-center justify-center transition disabled:opacity-40 disabled:pointer-events-none shrink-0">
            <SendIcon />
          </button>
        </div>
      )}
    </div>
  );
}
