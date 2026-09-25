"use client";

// WhatsApp Dialer — a REAL in-app dialer:
//   • phone-style keypad (digits, backspace) with country-code selector
//   • dialing any number opens its WhatsApp conversation INSIDE the CRM
//     (unknown numbers get a lead automatically — nothing external opens)
//   • the message box on the right is a WhatsApp-style chat that sends via
//     the Meta Cloud API and shows the provider's true result per bubble.
// Removed by design: wa.me deep links, tel: hand-offs, "open on device" —
// the user explicitly wants everything internal, no other app or device.
import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/lp/api";
import { GoldButton, GhostButton } from "./bits";
import { leadName, type LeadRow } from "./LeadsView";
import ChatPanel, { type ChatDetail } from "./ChatPanel";

const COUNTRIES = [
  { cc: "92", label: "+92 · PK" },
  { cc: "1", label: "+1 · US/CA" },
  { cc: "44", label: "+44 · UK" },
  { cc: "971", label: "+971 · AE" },
  { cc: "966", label: "+966 · SA" },
  { cc: "91", label: "+91 · IN" },
  { cc: "60", label: "+60 · MY" },
  { cc: "62", label: "+62 · ID" },
  { cc: "20", label: "+20 · EG" },
  { cc: "90", label: "+90 · TR" },
  { cc: "234", label: "+234 · NG" },
];

const KEYS: { d: string; sub: string }[] = [
  { d: "1", sub: "" }, { d: "2", sub: "ABC" }, { d: "3", sub: "DEF" },
  { d: "4", sub: "GHI" }, { d: "5", sub: "JKL" }, { d: "6", sub: "MNO" },
  { d: "7", sub: "PQRS" }, { d: "8", sub: "TUV" }, { d: "9", sub: "WXYZ" },
  { d: "*", sub: "" }, { d: "0", sub: "+" }, { d: "#", sub: "" },
];

function formatNumber(cc: string, digits: string): string {
  const rest = digits.replace(/\D/g, "");
  if (!rest) return `+${cc}`;
  const groups: string[] = [];
  let i = 0;
  while (i < rest.length) { groups.push(rest.slice(i, i + 3)); i += 3; }
  return `+${cc} ${groups.join(" ")}`;
}

type CallForm = { status: string; outcome: string; durationMin: string; durationSec: string; notes: string };

export default function DialerView({ user, onChanged }: {
  user: { id: string; role: string; name: string };
  employees: { id: string; name: string }[];
  onChanged?: () => void;
}) {
  const [cc, setCc] = useState("92");
  const [digits, setDigits] = useState("");
  const [waConnected, setWaConnected] = useState<boolean | null>(null);
  const [convId, setConvId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ChatDetail | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [dialError, setDialError] = useState("");
  const [chatError, setChatError] = useState("");
  const [windowClosedHint, setWindowClosedHint] = useState(false);
  const [sending, setSending] = useState(false);
  const [tplSending, setTplSending] = useState(false);
  const [dialing, setDialing] = useState(false);
  const [recents, setRecents] = useState<LeadRow[]>([]);
  const [logging, setLogging] = useState(false);
  const [callForm, setCallForm] = useState<CallForm>({ status: "completed", outcome: "interested", durationMin: "", durationSec: "", notes: "" });
  const [busy, setBusy] = useState(false);

  const loadRecents = useCallback(async () => {
    try {
      const data = await api<{ leads: LeadRow[] }>("/api/lp/leads?pageSize=200");
      setRecents(data.leads.filter((l) => l.whatsapp && l.status !== "archived").slice(0, 8));
    } catch { setRecents([]); }
  }, []);

  useEffect(() => {
    api<{ whatsapp: { connected: boolean } }>("/api/lp/integrations/whatsapp")
      .then((d) => setWaConnected(d.whatsapp.connected))
      .catch(() => setWaConnected(false));
    void loadRecents();
  }, [loadRecents]);

  const loadThread = useCallback(async (id: string) => {
    setThreadLoading(true);
    try {
      const data = await api<ChatDetail>(`/api/lp/conversations/${id}`);
      setDetail(data);
      setChatError("");
      setWindowClosedHint(false);
    } catch (e) {
      setDetail(null);
      setChatError(e instanceof Error ? e.message : "Could not open the conversation");
    } finally {
      setThreadLoading(false);
    }
  }, []);

  const press = (k: string) => {
    setDialError("");
    setDigits((d) => (d.length >= 15 ? d : d + k));
  };

  const dial = async (payload: { phone?: string; leadId?: string }) => {
    setDialing(true);
    setDialError("");
    try {
      const fc = await api<{ conversation: { id: string } }>("/api/lp/conversations/find-or-create", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setConvId(fc.conversation.id);
      await loadThread(fc.conversation.id);
      void loadRecents();
    } catch (e) {
      setDialError(e instanceof Error ? e.message : "Could not start the chat");
    } finally {
      setDialing(false);
    }
  };

  const dialKeypad = () => {
    const clean = digits.replace(/[^\d]/g, "");
    if (clean.length < 8) { setDialError("Enter the full number including country code (at least 8 digits)."); return; }
    void dial({ phone: `+${cc}${clean}` });
  };

  const sendText = async (body: string) => {
    if (!convId) return;
    setSending(true);
    setChatError("");
    try {
      await api(`/api/lp/conversations/${convId}/send`, { method: "POST", body: JSON.stringify({ kind: "text", body }) });
    } catch (e: unknown) {
      const data = (e as { data?: { hint?: string } }).data;
      setChatError(e instanceof Error ? e.message : "Send failed");
      if (data?.hint === "window_closed") setWindowClosedHint(true);
    } finally {
      await loadThread(convId).catch(() => null); // refresh: honest bubble statuses
      setSending(false);
    }
  };

  const sendTemplate = async (templateId: string, params: string[]) => {
    if (!convId) return;
    setTplSending(true);
    setChatError("");
    try {
      await api(`/api/lp/conversations/${convId}/send`, { method: "POST", body: JSON.stringify({ kind: "template", templateId, params }) });
      setWindowClosedHint(false);
    } catch (e: unknown) {
      setChatError(e instanceof Error ? e.message : "Template send failed");
      throw e;
    } finally {
      await loadThread(convId).catch(() => null);
      setTplSending(false);
    }
  };

  const logCall = async () => {
    if (!detail?.conversation) return;
    setBusy(true);
    try {
      const durationSec = callForm.status === "completed" ? Number(callForm.durationMin || 0) * 60 + Number(callForm.durationSec || 0) : null;
      await api("/api/lp/calls", {
        method: "POST",
        body: JSON.stringify({
          leadId: detail.conversation.leadId, status: callForm.status, outcome: callForm.outcome,
          method: "manual", durationSec: durationSec || null, notes: callForm.notes || null,
        }),
      });
      setLogging(false);
      setCallForm({ status: "completed", outcome: "interested", durationMin: "", durationSec: "", notes: "" });
      onChanged?.();
    } catch (e) {
      setDialError(e instanceof Error ? e.message : "Could not log");
    } finally {
      setBusy(false);
    }
  };

  const ChatIcon = (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5.1-1.3A10 10 0 1 0 12 2Zm0 2a8 8 0 1 1-4.1 14.9l-.5-.3-3 .8.8-2.9-.3-.5A8 8 0 0 1 12 4Z" /></svg>
  );

  const convLead = (detail?.conversation.lead || null) as LeadRow | null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4 h-[calc(100vh-150px)] min-h-0">
      {/* ── LEFT: the phone ── */}
      <div className="rounded-xl border border-slate-200 bg-white flex flex-col overflow-hidden min-h-0">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-900">Dialer</div>
          {waConnected !== null && (
            <span className={`text-[9px] px-2 py-1 rounded-full border font-medium ${waConnected ? "border-[#00a884]/40 bg-[#00a884]/10 text-[#008069]" : "border-rose-400/40 bg-rose-500/10 text-rose-600"}`}>
              {waConnected ? "WhatsApp API connected" : "WhatsApp API offline"}
            </span>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* Number display */}
          <div className="px-5 pt-6 pb-2 text-center">
            <select
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              className="mb-2 h-8 rounded-lg border border-slate-200 bg-slate-50 px-2 text-[11px] text-slate-700 focus:outline-none focus:border-[#3d7ff7]/60">
              {COUNTRIES.map((c) => <option key={c.cc} value={c.cc}>{c.label}</option>)}
            </select>
            <div className={`text-2xl tracking-wider tabular-nums min-h-9 font-medium ${digits ? "text-slate-900" : "text-slate-300"}`}>
              {formatNumber(cc, digits)}
            </div>
            <div className="text-[10px] text-slate-400 mt-1">
              {digits.length >= 8 ? "Ready — press the green button to open the chat" : "Type the number with the keypad below"}
            </div>
          </div>

          {/* Keypad */}
          <div className="px-8 pt-2 pb-4">
            <div className="grid grid-cols-3 gap-2.5">
              {KEYS.map((k) => (
                <button
                  key={k.d}
                  onClick={() => press(k.d)}
                  className="aspect-square rounded-full bg-slate-50 hover:bg-[#3d7ff7]/10 active:bg-[#3d7ff7]/20 border border-slate-200 flex flex-col items-center justify-center transition select-none">
                  <span className="text-xl font-medium text-slate-900 leading-none">{k.d}</span>
                  {k.sub && <span className="text-[8px] tracking-[0.18em] text-slate-400 mt-0.5">{k.sub}</span>}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-center gap-3 mt-4">
              <button
                onClick={() => setDigits((d) => d.slice(0, -1))}
                title="Backspace"
                className="w-12 h-12 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100 transition">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M9 5h11a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 20 19H9l-6.2-6.3a1 1 0 0 1 0-1.4L9 5Z" strokeLinejoin="round" /><path d="m12.5 9.5 5 5m0-5-5 5" strokeLinecap="round" /></svg>
              </button>
              <button
                onClick={dialKeypad}
                disabled={dialing || digits.replace(/\D/g, "").length < 8}
                title="Start WhatsApp chat"
                className="w-16 h-16 rounded-full bg-[#00a884] hover:bg-[#008069] text-white flex items-center justify-center shadow-lg shadow-[#00a884]/30 transition disabled:opacity-40 disabled:pointer-events-none">
                {dialing ? (
                  <span className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                ) : ChatIcon}
              </button>
              <button
                onClick={() => { setDigits(""); setDialError(""); }}
                title="Clear"
                className="w-12 h-12 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100 transition text-xs">CLR</button>
            </div>
            {dialError && <div className="mt-3 text-[11px] text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 text-center">{dialError}</div>}
            <div className="text-center text-[9px] text-slate-400 mt-3 leading-relaxed">
              Chats open inside the CRM — nothing opens on another app or device.
            </div>
          </div>

          {/* Recent contacts */}
          {recents.length > 0 && (
            <div className="border-t border-slate-200 px-3 py-3">
              <div className="text-[9px] uppercase tracking-wider text-slate-400 px-1 pb-1.5">Recent contacts — tap to chat</div>
              <div className="space-y-0.5">
                {recents.map((l) => (
                  <button key={l.id} onClick={() => void dial({ leadId: l.id })} disabled={dialing}
                    className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-slate-50 transition flex items-center gap-2.5 disabled:opacity-50">
                    <span className="w-8 h-8 rounded-full bg-[#00a884]/15 text-[#008069] text-[10px] font-bold flex items-center justify-center shrink-0">
                      {leadName(l).split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "#"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-medium text-slate-900 truncate">{leadName(l)}</span>
                      <span className="block text-[10px] text-slate-400 tabular-nums truncate">{l.whatsapp}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Call activity log (CRM record only) */}
          <div className="border-t border-slate-200 px-3 py-3">
            {detail ? (
              <>
                <GhostButton onClick={() => setLogging((v) => !v)} className="w-full justify-center">
                  {logging ? "Hide call log form" : "Log a call outcome for this contact"}
                </GhostButton>
                {logging && (
                  <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <select value={callForm.status} onChange={(e) => setCallForm((f) => ({ ...f, status: e.target.value }))} className="h-8 rounded bg-white border border-slate-200 px-2 text-xs text-slate-800">
                        {["completed", "missed", "busy", "no_answer", "failed"].map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                      </select>
                      <select value={callForm.outcome} onChange={(e) => setCallForm((f) => ({ ...f, outcome: e.target.value }))} className="h-8 rounded bg-white border border-slate-200 px-2 text-xs text-slate-800">
                        {["interested", "not_interested", "callback_requested", "qualified", "converted", "wrong_number", "do_not_contact"].map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                      </select>
                      <input value={callForm.durationMin} onChange={(e) => setCallForm((f) => ({ ...f, durationMin: e.target.value }))} placeholder="minutes" inputMode="numeric" className="h-8 rounded bg-white border border-slate-200 px-2 text-xs text-slate-900" />
                      <input value={callForm.durationSec} onChange={(e) => setCallForm((f) => ({ ...f, durationSec: e.target.value }))} placeholder="seconds" inputMode="numeric" className="h-8 rounded bg-white border border-slate-200 px-2 text-xs text-slate-900" />
                    </div>
                    <input value={callForm.notes} onChange={(e) => setCallForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Notes…" className="w-full h-8 rounded bg-white border border-slate-200 px-2 text-xs text-slate-900" />
                    <GoldButton disabled={busy} onClick={logCall} className="w-full justify-center">Save call record</GoldButton>
                  </div>
                )}
              </>
            ) : (
              <div className="text-[10px] text-slate-400 text-center">Call outcomes can be logged once a chat is open.</div>
            )}
          </div>
        </div>
      </div>

      {/* ── RIGHT: the message box ── */}
      {detail ? (
        <ChatPanel
          detail={detail}
          loading={threadLoading}
          leadName={convLead ? leadName(convLead) : (detail.conversation.waPhone || "Unknown")}
          leadCompany={convLead?.company || ""}
          optedOut={Boolean(convLead?.optedOut)}
          onSendText={sendText}
          sending={sending}
          onSendTemplate={sendTemplate}
          tplSending={tplSending}
          error={chatError}
          windowClosedHint={windowClosedHint}
          className="h-full"
        />
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 flex flex-col items-center justify-center text-center p-10">
          <div className="w-20 h-20 rounded-full bg-[#00a884]/10 text-[#00a884] flex items-center justify-center mb-4">{ChatIcon}</div>
          <div className="text-sm font-semibold text-slate-700">The message box opens here</div>
          <div className="text-xs text-slate-400 mt-1.5 max-w-sm leading-relaxed">
            Dial a number on the keypad (with country code) or tap a recent contact. The WhatsApp conversation opens inside the CRM — type freely once the 24h window is open, or start with an approved template.
          </div>
        </div>
      )}
    </div>
  );
}
