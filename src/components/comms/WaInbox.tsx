"use client";

// PlayBeat Pulse — REAL WhatsApp Business Inbox (spec §2/§3/§6).
// Three columns: conversations · chat · CRM contact panel.
// Every send goes through the Meta Cloud API with honest delivery states.
// Media, replies, templates, emoji, attachments — all internal, no hand-offs.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, getToken, type LpUser } from "@/lib/lp/api";
import { cn } from "@/lib/utils";
import { Avatar, fmtTime, timeAgo } from "./shared";

// ── types ──
type Conv = {
  id: string; waPhone: string | null; status: string; priority: string; tags: string;
  unreadCount: number; lastMessageAt: string | null; lastMessagePreview: string | null;
  waServiceWindowUntil: string | null; assignedToId: string | null;
  lead: { id: string; firstName: string | null; lastName: string | null; company: string | null; country: string | null; status: string; score: number; tags: string; optedOut: boolean };
  assignedTo: { id: string; name: string } | null;
  messages: { body: string; direction: string; kind: string; status: string; createdAt: string }[];
};
type Msg = {
  id: string; direction: string; kind: string; body: string; mediaUrl: string | null;
  metaJson: string | null; status: string; errorMessage: string | null; errorCode: string | null;
  createdAt: string; waMessageId?: string | null; sender?: { id: string; name: string } | null;
};
type Detail = {
  conversation: Conv & { lead: Conv["lead"] & { email: string | null; phone: string | null; city: string | null; source: string; lastContactAt: string | null; assignedTo?: { id: string; name: string } | null } };
  messages: Msg[];
  waConnected: boolean;
};
type Tpl = { id: string; name: string; language: string; bodyText: string; category: string; approvalStatus: string };
type Employee = { id: string; name: string };

const FILTERS = [
  { key: "all", label: "All" }, { key: "unread", label: "Unread" }, { key: "mine", label: "Assigned to me" },
  { key: "unassigned", label: "Unassigned" }, { key: "open", label: "Open" }, { key: "pending", label: "Pending" },
  { key: "resolved", label: "Resolved" }, { key: "hot", label: "Hot Leads" }, { key: "warm", label: "Warm" }, { key: "cold", label: "Cold" },
];

const EMOJIS = ["😀","😁","😂","🤣","😊","😍","😘","😎","🤝","👍","👎","👏","🙏","💪","🔥","⭐","✅","❌","💬","📎","📅","📍","💰","🎁","📞","⏰","🎯","🚀","❤️","🎉","😅","🙂","😐","🤔","😴","😅"];

function nameOf(c: Conv): string {
  const n = `${c.lead.firstName || ""} ${c.lead.lastName || ""}`.trim();
  return n || c.waPhone || "Unknown";
}
function leadStatusColor(s: string): string {
  return { new: "#94a3b8", contacted: "#3d7ff7", qualified: "#fbbf24", converted: "#25d366", archived: "#64748b", do_not_contact: "#f87171" }[s] || "#94a3b8";
}
function priorityColor(p: string): string {
  return { low: "#64748b", normal: "#94a3b8", high: "#f97316", urgent: "#f87171" }[p] || "#94a3b8";
}

// template placeholder helper (positional mapping, mirrors backend)
function templatePlaceholders(bodyText: string): { token: string; snippet: string }[] {
  const out: { token: string; snippet: string }[] = [];
  for (const m of bodyText.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) {
    const start = Math.max(0, (m.index ?? 0) - 22);
    const end = Math.min(bodyText.length, (m.index ?? 0) + m[0].length + 22);
    out.push({ token: m[1], snippet: `${start > 0 ? "…" : ""}${bodyText.slice(start, end).replace(/\s+/g, " ")}${end < bodyText.length ? "…" : ""}` });
  }
  return out;
}

// ── tick icons (WhatsApp-authentic SVG) ──
function Ticks({ status }: { status: string }) {
  if (status === "queued" || status === "sent") return (
    <svg width="15" height="11" viewBox="0 0 16 12" fill="none"><path d="M2.5 6.6 5.8 9.8 13.2 2.6" stroke={status === "sent" ? "#53bdeb" : "#8696a0"} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
  if (status === "delivered") return (
    <svg width="17" height="11" viewBox="0 0 18 12" fill="none"><path d="M1.5 6.6 4.8 9.8 12 2.6" stroke="#8696a0" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /><path d="M6.5 6.9 9.3 9.8 16.5 2.6" stroke="#8696a0" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
  if (status === "read") return (
    <svg width="17" height="11" viewBox="0 0 18 12" fill="none"><path d="M1.5 6.6 4.8 9.8 12 2.6" stroke="#53bdeb" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /><path d="M6.5 6.9 9.3 9.8 16.5 2.6" stroke="#53bdeb" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
  if (status === "failed") return <span className="text-[#f87171] text-[10px] leading-none">!</span>;
  return null;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, new Date())) return "TODAY";
  if (same(d, new Date(Date.now() - 86400000))) return "YESTERDAY";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }).toUpperCase();
}

// ── media bubble renderer (proxy-authenticated) ──
function MediaBody({ m }: { m: Msg }) {
  const meta = useMemo(() => { try { return m.metaJson ? JSON.parse(m.metaJson) : {}; } catch { return {}; } }, [m.metaJson]);
  const src = m.mediaUrl ? `/api/lp/communications/media/${m.mediaUrl}` : null;
  if (!src) return null;
  if (m.kind === "image") {
    return (
      <a href={src} target="_blank" rel="noreferrer" className="block rounded-lg overflow-hidden mb-1 max-w-[280px]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={meta.caption || "image"} className="max-w-full rounded-lg" loading="lazy" />
      </a>
    );
  }
  if (m.kind === "video") {
    return <video src={src} controls className="rounded-lg mb-1 max-w-[280px]" preload="metadata" />;
  }
  if (m.kind === "audio") {
    return <audio src={src} controls className="mb-1 max-w-[260px] h-9" preload="metadata" />;
  }
  if (m.kind === "document") {
    return (
      <a href={src} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 bg-black/25 rounded-lg px-3 py-2.5 mb-1 max-w-[280px] hover:bg-black/35 transition">
        <span className="w-9 h-9 rounded-lg bg-[#3d7ff7]/20 text-[#8db1ff] flex items-center justify-center text-sm shrink-0">⬇</span>
        <span className="min-w-0">
          <span className="block text-xs text-slate-100 truncate">{meta.filename || "Document"}</span>
          <span className="block text-[10px] text-slate-400">{meta.mimeType || "file"}</span>
        </span>
      </a>
    );
  }
  return null;
}

export default function WaInbox({ user, employees, onCallCustomer, autoOpenPhone }: {
  user: LpUser;
  employees: Employee[];
  onCallCustomer: (phone: string, name: string) => void;
  autoOpenPhone?: string | null;
}) {
  const [convs, setConvs] = useState<Conv[]>([]);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [tpls, setTpls] = useState<Tpl[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [windowClosedHint, setWindowClosedHint] = useState(false);
  const [rightTab, setRightTab] = useState<"details" | "actions">("details");
  const [assignOpen, setAssignOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [tplOpen, setTplOpen] = useState(false);
  const [tplId, setTplId] = useState("");
  const [tplParams, setTplParams] = useState<string[]>([]);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [noteText, setNoteText] = useState("");
  const [followUpAt, setFollowUpAt] = useState("");
  const [panelMsg, setPanelMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastCountRef = useRef(0);

  const loadConvs = useCallback(async () => {
    try {
      const d = await api<{ conversations: Conv[] }>(`/api/lp/conversations?filter=${filter}${q ? `&q=${encodeURIComponent(q)}` : ""}`);
      setConvs(d.conversations);
    } catch { /* keep */ }
  }, [filter, q]);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const d = await api<Detail>(`/api/lp/conversations/${id}`);
      setDetail(d);
      setWindowClosedHint(false);
      if (d.conversation.unreadCount > 0) {
        await api(`/api/lp/conversations/${id}/read`, { method: "POST" }).catch(() => {});
        setConvs((cs) => cs.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)));
      }
    } catch { /* keep */ }
  }, []);

  useEffect(() => { void loadConvs(); }, [loadConvs]);
  useEffect(() => { if (openId) void loadDetail(openId); }, [openId, loadDetail]);

  // dialer/contacts handoff: open the conversation for the given phone
  const autoOpenedRef = useRef("");
  useEffect(() => {
    if (!autoOpenPhone || autoOpenedRef.current === autoOpenPhone) return;
    autoOpenedRef.current = autoOpenPhone;
    const digits = autoOpenPhone.replace(/\D/g, "");
    (async () => {
      try {
        const d = await api<{ conversations: Conv[] }>("/api/lp/conversations?filter=all");
        setConvs(d.conversations);
        const match = d.conversations.find((c) => (c.waPhone || "").replace(/\D/g, "") === digits);
        if (match) { setOpenId(match.id); lastCountRef.current = -1; }
      } catch { /* keep */ }
    })();
  }, [autoOpenPhone]);
  useEffect(() => { const t = setInterval(() => { void loadConvs(); if (openId) void loadDetailSilent(openId); }, 4000); return () => clearInterval(t); }, [loadConvs, openId]);

  // silent thread refresh — preserves composer state, updates ticks
  const loadDetailSilent = useCallback(async (id: string) => {
    try {
      const d = await api<Detail>(`/api/lp/conversations/${id}`);
      setDetail((prev) => (prev && prev.conversation.id === id ? d : prev));
    } catch { /* keep */ }
  }, []);

  useEffect(() => {
    if (detail && detail.messages.length !== lastCountRef.current) {
      lastCountRef.current = detail.messages.length;
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [detail]);

  useEffect(() => {
    api<{ templates: Tpl[] }>("/api/lp/templates").then((d) => setTpls(d.templates.filter((t) => t.approvalStatus === "meta_approved"))).catch(() => {});
  }, [openId]);

  const approved = tpls;
  const picked = approved.find((t) => t.id === tplId) || null;
  const pickedPh = picked ? templatePlaceholders(picked.bodyText) : [];
  const windowOpen = detail?.conversation.waServiceWindowUntil ? new Date(detail.conversation.waServiceWindowUntil).getTime() > Date.now() : false;
  const quickTpls = approved.filter((t) => !/\{\{\s*\d+\s*\}\}/.test(t.bodyText));

  const doSend = async (payload: Record<string, unknown>) => {
    if (!openId || sending) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch(`/api/lp/conversations/${openId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
        body: JSON.stringify({ ...payload, replyToMessageId: replyTo?.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.hint === "window_closed") setWindowClosedHint(true);
        setError(data.error || `Send failed (${res.status})`);
      }
      await loadDetailSilent(openId);
      await loadConvs();
    } catch (e) {
      setError(e instanceof Error ? e.message : "network error");
    } finally {
      setSending(false);
      setReplyTo(null);
    }
  };

  const doSendText = async () => {
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    await doSend({ kind: "text", body });
  };

  const doAttach = async (file: File) => {
    if (!openId) return;
    setSending(true); setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const up = await fetch("/api/lp/communications/media/upload", {
        method: "POST",
        body: fd,
        headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
      });
      const upData = await up.json().catch(() => ({}));
      if (!up.ok) throw new Error(upData.error || `upload failed (${up.status})`);
      const kind = upData.mimeType.startsWith("image/") ? "image" : upData.mimeType.startsWith("video/") ? "video" : upData.mimeType.startsWith("audio/") ? "audio" : "document";
      await doSend({ kind, mediaId: upData.mediaId, filename: upData.filename, caption: "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "upload failed");
    } finally {
      setSending(false);
    }
  };

  const patchConv = async (patch: Record<string, unknown>) => {
    if (!openId) return;
    try {
      await api(`/api/lp/conversations/${openId}`, { method: "PATCH", body: JSON.stringify(patch) });
      await loadDetail(openId);
      await loadConvs();
      setPanelMsg("Saved.");
      setTimeout(() => setPanelMsg(""), 2500);
    } catch (e) {
      setPanelMsg(e instanceof Error ? e.message : "update failed");
      setTimeout(() => setPanelMsg(""), 3500);
    }
  };

  const conv = detail?.conversation;
  const leadName = conv ? nameOf(conv) : "";

  return (
    <div className="h-full flex min-h-0">
      {/* ═══ LEFT — conversations ═══ */}
      <div className={cn("w-full md:w-[300px] lg:w-[320px] shrink-0 border-r border-[var(--cm-border)] flex flex-col min-h-0 bg-[rgba(8,12,22,0.45)]", openId && "hidden md:flex")}>
        <div className="p-3 border-b border-[var(--cm-border)]">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, number, message…" className="comms-input w-full h-9 px-3 text-xs" />
          <div className="flex gap-1 flex-wrap mt-2">
            {FILTERS.map((f) => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className={cn("text-[10px] px-2 py-1 rounded-full border transition", filter === f.key ? "bg-[rgba(61,127,247,0.2)] border-[#3d7ff7]/50 text-[#bcd2ff]" : "comms-chip text-slate-400 hover:text-slate-200")}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto comms-scroll">
          {convs.length === 0 && <div className="p-6 text-center text-xs text-slate-500">No conversations{filter !== "all" ? ` in "${FILTERS.find((f) => f.key === filter)?.label}"` : ""}. Inbound WhatsApp messages land here automatically.</div>}
          {convs.map((c) => {
            const last = c.messages[0];
            const active = c.id === openId;
            return (
              <button key={c.id} onClick={() => { setOpenId(c.id); lastCountRef.current = -1; }}
                className={cn("w-full text-left px-3 py-2.5 border-b border-[rgba(148,163,184,0.07)] transition flex gap-2.5", active ? "bg-[rgba(61,127,247,0.14)]" : "hover:bg-[rgba(148,163,184,0.05)]")}>
                <div className="relative shrink-0">
                  <Avatar name={nameOf(c)} size={40} />
                  {c.priority !== "normal" && (
                    <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full text-[8px] font-bold flex items-center justify-center text-white" style={{ backgroundColor: priorityColor(c.priority) }}>!</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-slate-100 truncate flex-1">{nameOf(c)}</span>
                    <span className="text-[9px] text-slate-500 shrink-0">{c.lastMessageAt ? timeAgo(c.lastMessageAt) : ""}</span>
                  </div>
                  <div className="text-[11px] text-slate-400 truncate mt-0.5">{last ? `${last.direction === "outbound" ? "You: " : ""}${last.body}` : "—"}</div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full border border-[rgba(148,163,184,0.2)] text-slate-400">{c.lead.status.replace(/_/g, " ")}</span>
                    {c.assignedTo ? <span className="text-[9px] text-slate-500">→ {c.assignedTo.name}</span> : <span className="text-[9px] text-amber-400/80">unassigned</span>}
                    {c.unreadCount > 0 && <span className="ml-auto text-[9px] bg-[#25d366] text-[#06281a] font-bold rounded-full px-1.5 py-0.5 min-w-4 text-center">{c.unreadCount}</span>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ═══ CENTER — chat ═══ */}
      <div className={cn("flex-1 min-w-0 flex flex-col min-h-0", !openId && "hidden md:flex")}>
        {!conv ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-8">
            <div className="w-16 h-16 rounded-3xl comms-btn-wa flex items-center justify-center text-white text-2xl opacity-80">✆</div>
            <div className="mt-4 text-sm font-semibold text-slate-300">PlayBeat Pulse WhatsApp Inbox</div>
            <div className="mt-1 text-xs text-slate-500 max-w-sm leading-relaxed">Select a conversation — inbound messages arrive through the Meta webhook in real time. Replies send via the WhatsApp Cloud API with honest delivery states.</div>
          </div>
        ) : (
          <>
            {/* header */}
            <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 border-b border-[var(--cm-border)] bg-[rgba(8,12,22,0.55)]">
              <button onClick={() => setOpenId(null)} className="md:hidden text-slate-400 text-sm">←</button>
              <Avatar name={leadName} size={36} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-100 truncate">{leadName}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full border" style={{ color: leadStatusColor(conv.lead.status), borderColor: `${leadStatusColor(conv.lead.status)}55` }}>{conv.lead.status.replace(/_/g, " ")}</span>
                </div>
                <div className="text-[11px] text-slate-500 truncate">{conv.waPhone} · agent {conv.assignedTo?.name || "unassigned"}</div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => onCallCustomer(conv.lead.phone || conv.waPhone || "", leadName)} title="Call customer — opens the Phone console with this number"
                  className="h-8 px-2.5 rounded-lg comms-chip text-[10px] text-slate-300 hover:text-white transition">☏ Call</button>
                <button onClick={() => setRightTab(rightTab === "details" ? "actions" : "details")} title="Contact panel"
                  className="h-8 px-2.5 rounded-lg comms-chip text-[10px] text-slate-300 hover:text-white transition">☰ {rightTab === "details" ? "Details" : "Actions"}</button>
                <div className="relative">
                  <button onClick={() => setAssignOpen((v) => !v)} className="h-8 px-2.5 rounded-lg comms-chip text-[10px] text-slate-300 hover:text-white transition">Assign ▾</button>
                  {assignOpen && (
                    <div className="absolute right-0 top-9 w-44 comms-panel z-30 p-1 shadow-2xl" style={{ background: "var(--cm-panel-solid)" }}>
                      <button onClick={() => { void patchConv({ assignedToId: null }); setAssignOpen(false); }} className="w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] text-slate-400 hover:bg-[rgba(148,163,184,0.08)]">Unassigned</button>
                      {employees.map((e) => (
                        <button key={e.id} onClick={() => { void patchConv({ assignedToId: e.id, assignedName: e.name }); setAssignOpen(false); }}
                          className={cn("w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] transition", conv.assignedToId === e.id ? "text-[#8db1ff] bg-[rgba(61,127,247,0.12)]" : "text-slate-300 hover:bg-[rgba(148,163,184,0.08)]")}>
                          {e.name}{e.id === user.id ? " (me)" : ""}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button onClick={() => void patchConv({ status: conv.status === "resolved" ? "open" : "resolved" })}
                  className={cn("h-8 px-2.5 rounded-lg text-[10px] font-medium transition border", conv.status === "resolved" ? "comms-chip text-slate-400" : "border-[#25d366]/40 bg-[#25d366]/10 text-[#4ade80] hover:bg-[#25d366]/20")}>
                  {conv.status === "resolved" ? "Reopen" : "✓ Resolve"}
                </button>
              </div>
            </div>

            {/* window state strip */}
            <div className={cn("shrink-0 px-4 py-1.5 text-[10px] flex items-center gap-2 border-b", windowOpen ? "border-[rgba(37,211,102,0.15)] bg-[rgba(37,211,102,0.06)] text-[#4ade80]" : "border-[rgba(251,191,36,0.15)] bg-[rgba(251,191,36,0.05)] text-amber-300/90")}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: windowOpen ? "#25d366" : "#fbbf24" }} />
              {windowOpen ? "24h free-text window OPEN — Meta accepts free-form messages until " + new Date(conv.waServiceWindowUntil!).toLocaleString() : "24h window CLOSED — business-initiated sends require a Meta-approved template"}
              {conv.lead.optedOut && <span className="ml-auto text-rose-300 font-semibold">SUPPRESSED — contact opted out</span>}
            </div>

            {/* timeline */}
            <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto comms-scroll comms-chat-wall px-3 sm:px-6 py-4 space-y-1">
              {detail!.messages.length === 0 && (
                <div className="h-full min-h-40 flex items-center justify-center">
                  <div className="bg-[rgba(148,163,184,0.08)] border border-[var(--cm-border)] text-slate-400 text-[11px] px-4 py-2.5 rounded-xl max-w-md text-center">
                    No messages yet. {windowOpen ? "Type below — the window is open." : "Send an approved template to start the conversation."}
                  </div>
                </div>
              )}
              {detail!.messages.map((m, i) => {
                const out = m.direction === "outbound";
                const showDay = i === 0 || dayLabel(detail!.messages[i - 1].createdAt) !== dayLabel(m.createdAt);
                const meta = (() => { try { return m.metaJson ? JSON.parse(m.metaJson) : {}; } catch { return {}; } })();
                const repliedMsg = meta.replyToMessageId || meta.replyToWaMessageId ? detail!.messages.find((x) => x.id === meta.replyToMessageId || x.waMessageId === meta.replyToWaMessageId) : null;
                return (
                  <div key={m.id}>
                    {showDay && <div className="flex justify-center my-3"><span className="comms-chip text-slate-400 text-[10px] font-medium px-3 py-1">{dayLabel(m.createdAt)}</span></div>}
                    <div className={cn("group flex mb-1", out ? "justify-end" : "justify-start")}>
                      <div className={cn("relative max-w-[78%] px-2.5 py-1.5 shadow-lg", out ? "comms-bubble-out" : "comms-bubble-in", m.status === "failed" && "ring-1 ring-[#f87171]")}>
                        {repliedMsg && (
                          <div className="border-l-2 border-[#53bdeb] bg-black/20 rounded px-2 py-1 mb-1 max-w-[260px]">
                            <div className="text-[10px] font-semibold text-[#53bdeb] truncate">{repliedMsg.direction === "outbound" ? (repliedMsg.sender?.name || "You") : leadName}</div>
                            <div className="text-[10px] text-slate-300/80 truncate">{repliedMsg.body}</div>
                          </div>
                        )}
                        <MediaBody m={m} />
                        {m.kind === "template" && <div className="text-[9px] uppercase tracking-wider text-[#fbbf24]/80 mb-0.5">template message</div>}
                        {m.kind === "interactive" && !out && <div className="text-[9px] uppercase tracking-wider text-[#8db1ff]/80 mb-0.5">interactive reply</div>}
                        {m.kind !== "image" && m.kind !== "video" && m.kind !== "audio" && m.kind !== "document" && (
                          <div className="text-[13px] leading-snug text-slate-100 whitespace-pre-wrap break-words pr-12">{m.body}</div>
                        )}
                        <div className={cn("flex items-center gap-1 justify-end", m.kind === "image" || m.kind === "video" || m.kind === "document" || m.kind === "audio" ? "" : "mt-0.5")}>
                          {m.errorCode && <span className="text-[9px] text-[#f87171]">err {m.errorCode}</span>}
                          <span className="text-[9px] text-slate-400/80">{fmtTime(m.createdAt)}</span>
                          {out && <Ticks status={m.status} />}
                        </div>
                        {m.status === "failed" && m.errorMessage && (
                          <div className="mt-1 pt-1 border-t border-[#f87171]/30 text-[10px] text-[#f87171] flex items-start gap-1">
                            <span className="font-semibold shrink-0">Not delivered:</span><span className="leading-snug">{m.errorMessage}</span>
                          </div>
                        )}
                        {!out && (
                          <button onClick={() => setReplyTo(m)} title="Reply" className="absolute -left-8 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full comms-chip text-[10px] text-slate-500 opacity-0 group-hover:opacity-100 transition hidden md:flex items-center justify-center">↩</button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* template quick-bar when window closed */}
            {conv && !conv.lead.optedOut && !windowOpen && (
              <div className="shrink-0 mx-3 my-1.5 rounded-xl border border-[rgba(251,191,36,0.25)] bg-[rgba(251,191,36,0.05)] px-3 py-2">
                <div className="text-[11px] text-amber-200/90">Approved templates deliver business-initiated — tap to send:</div>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {quickTpls.length === 0 && <span className="text-[10px] text-amber-300/70">No zero-parameter templates — open the template picker for templates with variables.</span>}
                  {quickTpls.map((t) => (
                    <button key={t.id} disabled={sending} onClick={() => void doSend({ kind: "template", templateId: t.id, params: [] })}
                      className="text-[10px] font-medium px-2.5 py-1 rounded-full border border-[#25d366]/40 bg-[#25d366]/10 text-[#4ade80] hover:bg-[#25d366]/20 transition disabled:opacity-50">
                      {t.name}
                    </button>
                  ))}
                  <button onClick={() => setTplOpen(true)} className="text-[10px] font-medium px-2.5 py-1 rounded-full comms-chip text-slate-300 hover:text-white transition">More templates…</button>
                </div>
              </div>
            )}

            {error && <div className="shrink-0 mx-3 mb-1.5 text-[11px] text-[#f87171] bg-[rgba(248,113,113,0.08)] border border-[#f87171]/30 rounded-xl px-3 py-2 leading-relaxed">{error}</div>}

            {/* template picker panel */}
            {tplOpen && (
              <div className="shrink-0 border-t border-[var(--cm-border)] bg-[rgba(8,12,22,0.85)] px-3 py-3 max-h-64 overflow-y-auto comms-scroll">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold text-slate-200">Meta-approved templates</div>
                  <button onClick={() => setTplOpen(false)} className="text-[11px] text-[#8db1ff] hover:underline">Close</button>
                </div>
                {approved.length === 0 && <div className="text-[11px] text-slate-500 py-2">No approved templates. Sync them under Templates.</div>}
                <div className="space-y-1.5">
                  {approved.map((t) => (
                    <div key={t.id} className={cn("rounded-xl border transition", tplId === t.id ? "border-[#3d7ff7]/60 bg-[rgba(61,127,247,0.08)]" : "border-[var(--cm-border)] hover:bg-[rgba(148,163,184,0.05)]")}>
                      <button className="w-full text-left px-3 py-2" onClick={() => { setTplId(tplId === t.id ? "" : t.id); setTplParams([]); }}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-100">{t.name}</span>
                          <span className="text-[9px] text-slate-500">{t.category} · {t.language}</span>
                        </div>
                        <div className="text-[11px] text-slate-400 truncate mt-0.5">{t.bodyText.replace(/\s+/g, " ").slice(0, 90)}</div>
                      </button>
                      {tplId === t.id && (
                        <div className="px-3 pb-2.5 space-y-1.5">
                          <div className="text-[10px] whitespace-pre-wrap text-slate-400 bg-[rgba(148,163,184,0.07)] rounded-lg p-2 max-h-20 overflow-y-auto">{t.bodyText}</div>
                          {pickedPh.length > 0 && pickedPh.map((p, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <span className="text-[9px] font-mono text-[#8db1ff] bg-[rgba(61,127,247,0.12)] rounded px-1.5 py-0.5 whitespace-nowrap">{`{{${p.token}}}`}</span>
                              {/^\d+$/.test(p.token) ? (
                                <input value={tplParams[i] || ""} onChange={(e) => setTplParams((arr) => { const n = [...arr]; n[i] = e.target.value; return n; })}
                                  placeholder={p.snippet} className="comms-input flex-1 h-7 px-2 text-[11px]" />
                              ) : (
                                <span className="text-[10px] text-slate-500 italic">auto from CRM · {p.snippet}</span>
                              )}
                            </div>
                          ))}
                          <button
                            onClick={() => { void doSend({ kind: "template", templateId: t.id, params: tplParams }); setTplOpen(false); setTplId(""); setTplParams([]); }}
                            disabled={sending || pickedPh.some((p, i) => /^\d+$/.test(p.token) && !(tplParams[i] || "").trim())}
                            className="w-full h-8 rounded-full comms-btn-wa text-white text-xs font-semibold transition disabled:opacity-50">
                            {sending ? "Sending…" : "Send template"}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* emoji panel */}
            {emojiOpen && (
              <div className="shrink-0 border-t border-[var(--cm-border)] bg-[rgba(8,12,22,0.85)] p-2 grid grid-cols-12 gap-0.5 max-h-40 overflow-y-auto comms-scroll">
                {EMOJIS.map((e) => (
                  <button key={e} onClick={() => { setDraft((d) => d + e); setEmojiOpen(false); }} className="w-8 h-8 rounded-lg hover:bg-[rgba(148,163,184,0.1)] text-base">{e}</button>
                ))}
              </div>
            )}

            {/* reply preview */}
            {replyTo && (
              <div className="shrink-0 mx-3 mt-1.5 flex items-center gap-2 rounded-xl border-l-2 border-[#53bdeb] bg-[rgba(83,189,235,0.06)] px-3 py-1.5">
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-semibold text-[#53bdeb]">Replying to {replyTo.direction === "outbound" ? "yourself" : leadName}</div>
                  <div className="text-[11px] text-slate-400 truncate">{replyTo.body}</div>
                </div>
                <button onClick={() => setReplyTo(null)} className="text-slate-500 hover:text-slate-300 text-xs">✕</button>
              </div>
            )}

            {/* composer */}
            {conv.lead.optedOut ? (
              <div className="shrink-0 m-3 text-[11px] text-[#f87171] bg-[rgba(248,113,113,0.08)] border border-[#f87171]/30 rounded-xl px-3 py-2.5 text-center">
                This contact is on the suppression list (opted out) — sending is blocked by compliance policy.
              </div>
            ) : (
              <div className="shrink-0 flex items-end gap-1.5 px-3 py-2.5 border-t border-[var(--cm-border)] bg-[rgba(8,12,22,0.55)]">
                <input ref={fileRef} type="file" className="hidden" accept="image/*,video/mp4,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void doAttach(f); e.target.value = ""; }} />
                <button onClick={() => fileRef.current?.click()} title="Attach" disabled={sending}
                  className="w-9 h-9 rounded-full comms-chip flex items-center justify-center text-slate-400 hover:text-white transition disabled:opacity-40">+</button>
                <button onClick={() => setTplOpen((v) => !v)} title="Templates"
                  className={cn("w-9 h-9 rounded-full comms-chip flex items-center justify-center transition", tplOpen ? "bg-[rgba(61,127,247,0.25)] text-white" : "text-slate-400 hover:text-white")}>▦</button>
                <button onClick={() => setEmojiOpen((v) => !v)} title="Emoji"
                  className={cn("w-9 h-9 rounded-full comms-chip flex items-center justify-center transition text-sm", emojiOpen ? "bg-[rgba(61,127,247,0.25)] text-white" : "text-slate-400 hover:text-white")}>☺</button>
                <textarea value={draft} onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void doSendText(); } }}
                  rows={1}
                  placeholder={windowOpen ? "Type a message…" : "Free text delivers once the contact replies — or send a template"}
                  className="comms-input flex-1 px-3.5 py-2 text-[13px] resize-none max-h-28 rounded-2xl" />
                <button onClick={() => void doSendText()} disabled={sending || !draft.trim()} title="Send"
                  className="w-9 h-9 rounded-full comms-btn-wa text-white flex items-center justify-center transition disabled:opacity-40 disabled:pointer-events-none shrink-0">
                  {sending ? <span className="text-[10px]">…</span> : <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z" /></svg>}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ═══ RIGHT — CRM contact panel ═══ */}
      <div className={cn("w-full md:w-[290px] lg:w-[310px] shrink-0 border-l border-[var(--cm-border)] flex-col min-h-0 bg-[rgba(8,12,22,0.45)] overflow-y-auto comms-scroll", rightTab === "details" && conv ? "flex" : "hidden xl:flex")}>
        {!conv ? (
          <div className="p-6 text-center text-xs text-slate-500 mt-10">CRM context appears here when a conversation is open.</div>
        ) : (
          <div className="p-4 space-y-4">
            <div className="text-center">
              <Avatar name={leadName} size={64} className="mx-auto" />
              <div className="mt-2 text-sm font-semibold text-slate-100">{leadName}</div>
              <div className="text-[11px] text-slate-500">{conv.lead.company || "—"}</div>
              <div className="mt-2 flex justify-center gap-1.5 flex-wrap">
                <span className="text-[9px] px-2 py-0.5 rounded-full border" style={{ color: leadStatusColor(conv.lead.status), borderColor: `${leadStatusColor(conv.lead.status)}55` }}>{conv.lead.status}</span>
                <span className="comms-chip text-[9px] px-2 py-0.5 text-slate-400">score {conv.lead.score}</span>
                <span className="comms-chip text-[9px] px-2 py-0.5 text-slate-400">{conv.lead.source}</span>
              </div>
            </div>

            <div className="rounded-xl border border-[var(--cm-border)] divide-y divide-[rgba(148,163,184,0.08)] text-[11px]">
              {[
                ["WhatsApp", conv.waPhone], ["Phone", conv.lead.phone], ["Email", conv.lead.email],
                ["Country", conv.lead.country], ["City", conv.lead.city], ["Agent", conv.assignedTo?.name || "unassigned"],
                ["Last contact", conv.lead.lastContactAt ? timeAgo(conv.lead.lastContactAt) + " ago" : "—"],
              ].map(([k, v]) => (
                <div key={k as string} className="flex justify-between gap-2 px-3 py-2">
                  <span className="text-slate-500">{k}</span>
                  <span className="text-slate-200 truncate text-right">{(v as string) || "—"}</span>
                </div>
              ))}
            </div>

            {/* tags */}
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">Tags</div>
              <div className="flex flex-wrap gap-1.5">
                {(safeTags(conv.tags)).map((t) => <span key={t} className="comms-chip text-[10px] px-2 py-0.5 text-slate-300">{t}</span>)}
                {(safeTags(conv.lead.tags)).filter((t) => !safeTags(conv.tags).includes(t)).map((t) => <span key={t} className="comms-chip text-[10px] px-2 py-0.5 text-slate-400">{t}</span>)}
              </div>
              <div className="flex gap-1.5 mt-2">
                <input value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="add tag…" className="comms-input flex-1 h-7 px-2 text-[11px]" />
                <button onClick={() => { if (tagInput.trim()) { void patchConv({ tags: [...safeTags(conv.tags), tagInput.trim()] }); setTagInput(""); } }}
                  className="h-7 px-2.5 rounded-lg comms-btn-primary text-white text-[10px] font-medium">Add</button>
              </div>
            </div>

            {/* priority */}
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">Priority</div>
              <div className="grid grid-cols-4 gap-1">
                {["low", "normal", "high", "urgent"].map((p) => (
                  <button key={p} onClick={() => void patchConv({ priority: p })}
                    className={cn("text-[10px] py-1.5 rounded-lg border transition capitalize", conv.priority === p ? "font-semibold" : "comms-chip text-slate-400 hover:text-slate-200")}
                    style={conv.priority === p ? { borderColor: `${priorityColor(p)}88`, color: priorityColor(p), backgroundColor: `${priorityColor(p)}18` } : {}}>
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* quick actions */}
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">Quick actions</div>
              <div className="space-y-1.5">
                <button onClick={() => onCallCustomer(conv.lead.phone || conv.waPhone || "", leadName)} className="w-full h-8 rounded-lg comms-chip text-[11px] text-slate-200 hover:border-[var(--cm-border-strong)] transition text-left px-3">☏ Call customer</button>
                <a href={`/metacrm/#/leads`} target="_blank" rel="noreferrer" className="block w-full h-8 rounded-lg comms-chip text-[11px] text-slate-200 hover:border-[var(--cm-border-strong)] transition leading-8 px-3 text-left">◎ Open CRM profile ↗</a>
                <div className="rounded-lg border border-[var(--cm-border)] p-2.5 space-y-1.5">
                  <div className="text-[10px] text-slate-400">Add note</div>
                  <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={2} placeholder="Note against the lead…" className="comms-input w-full px-2 py-1.5 text-[11px] resize-none" />
                  <button onClick={async () => {
                    if (!noteText.trim()) return;
                    try {
                      await api(`/api/lp/leads/${conv.lead.id}/notes`, { method: "POST", body: JSON.stringify({ body: noteText }) });
                      setNoteText(""); setPanelMsg("Note saved."); setTimeout(() => setPanelMsg(""), 2500);
                    } catch (e) { setPanelMsg(e instanceof Error ? e.message : "failed"); setTimeout(() => setPanelMsg(""), 3000); }
                  }} className="w-full h-7 rounded-lg comms-btn-primary text-white text-[10px] font-medium">Save note</button>
                  <div className="text-[10px] text-slate-400 pt-1">Create follow-up</div>
                  <input type="datetime-local" value={followUpAt} onChange={(e) => setFollowUpAt(e.target.value)} className="comms-input w-full h-7 px-2 text-[11px]" />
                  <button onClick={async () => {
                    if (!followUpAt) return;
                    try {
                      await api("/api/lp/followups", { method: "POST", body: JSON.stringify({ leadId: conv.lead.id, dueAt: new Date(followUpAt).toISOString(), notes: "From communications console" }) });
                      setFollowUpAt(""); setPanelMsg("Follow-up created."); setTimeout(() => setPanelMsg(""), 2500);
                    } catch (e) { setPanelMsg(e instanceof Error ? e.message : "failed"); setTimeout(() => setPanelMsg(""), 3000); }
                  }} className="w-full h-7 rounded-lg comms-chip text-slate-200 text-[10px] font-medium hover:border-[var(--cm-border-strong)] transition">Schedule follow-up</button>
                </div>
              </div>
            </div>
            {panelMsg && <div className="text-[10px] text-center text-[#4ade80]">{panelMsg}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function safeTags(json: string): string[] {
  try { const v = JSON.parse(json || "[]"); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
}
