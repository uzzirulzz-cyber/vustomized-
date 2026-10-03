"use client";

// Inbox — WhatsApp-style message box (list + chat + CRM profile).
// Sends go through the Meta Cloud API via ChatPanel; results are honest.
import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/lp/api";
import { StatusPill, EmptyState, timeAgo } from "./bits";
import { leadName } from "./LeadsView";
import ChatPanel, { type ChatDetail } from "./ChatPanel";

type ConvRow = {
  id: string; waPhone: string | null; lastMessagePreview: string | null; lastMessageAt: string | null;
  unreadCount: number; channel: string; status: string;
  lead: { id: string; firstName: string | null; lastName: string | null; company: string | null; country: string | null; status: string; score: number; tags: string; optedOut: boolean; whatsapp?: string | null };
  assignedTo?: { id: string; name: string } | null;
  messages: { body: string; direction: string; createdAt: string }[];
};

const FILTERS = [
  ["all", "All"], ["unread", "Unread"], ["mine", "Assigned to Me"],
  ["whatsapp", "WhatsApp"], ["facebook", "Facebook"], ["replies", "Campaign Replies"],
] as const;

export default function InboxView({ user, openConversationId, setOpenConversationId }: {
  user: { id: string; role: string; name: string };
  openConversationId: string | null;
  setOpenConversationId: (id: string | null) => void;
}) {
  const [filter, setFilter] = useState<string>("all");
  const [convs, setConvs] = useState<ConvRow[]>([]);
  const [detail, setDetail] = useState<ChatDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [tplSending, setTplSending] = useState(false);
  const [error, setError] = useState("");
  const [windowClosedHint, setWindowClosedHint] = useState(false);

  const loadList = useCallback(async () => {
    const data = await api<{ conversations: ConvRow[] }>(`/api/lp/conversations?filter=${filter}`);
    setConvs(data.conversations);
  }, [filter]);

  const loadDetail = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const data = await api<ChatDetail>(`/api/lp/conversations/${id}`);
      setDetail(data);
      setError("");
      setWindowClosedHint(false);
      if ((data.conversation.unreadCount ?? 0) > 0) {
        await api(`/api/lp/conversations/${id}/read`, { method: "POST" });
        void loadList();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load conversation");
    } finally {
      setLoading(false);
    }
  }, [loadList]);

  useEffect(() => { void loadList(); const t = setInterval(loadList, 10000); return () => clearInterval(t); }, [loadList]);
  useEffect(() => { if (openConversationId) void loadDetail(openConversationId); }, [openConversationId, loadDetail]);

  const sendText = async (body: string) => {
    if (!openConversationId) return;
    setSending(true);
    setError("");
    try {
      await api(`/api/lp/conversations/${openConversationId}/send`, { method: "POST", body: JSON.stringify({ kind: "text", body }) });
    } catch (e: unknown) {
      const data = (e as { data?: { hint?: string } }).data;
      setError(e instanceof Error ? e.message : "Send failed");
      if (data?.hint === "window_closed") setWindowClosedHint(true);
    } finally {
      await loadDetail(openConversationId!).catch(() => null);
      void loadList();
      setSending(false);
    }
  };

  const sendTemplate = async (templateId: string, params: string[]) => {
    if (!openConversationId) return;
    setTplSending(true);
    setError("");
    try {
      await api(`/api/lp/conversations/${openConversationId}/send`, { method: "POST", body: JSON.stringify({ kind: "template", templateId, params }) });
      setWindowClosedHint(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Template send failed");
      throw e;
    } finally {
      await loadDetail(openConversationId!).catch(() => null);
      void loadList();
      setTplSending(false);
    }
  };

  const lead = (detail?.conversation.lead || null) as ConvRow["lead"] | null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] xl:grid-cols-[280px_1fr_260px] gap-4 h-[calc(100vh-150px)] min-h-0">
      {/* Left: conversation list */}
      <div className="rounded-xl border border-slate-200 bg-white flex flex-col overflow-hidden min-h-0">
        <div className="p-3 border-b border-slate-200 shrink-0">
          <div className="flex flex-wrap gap-1">
            {FILTERS.map(([key, label]) => (
              <button key={key} onClick={() => setFilter(key)}
                className={`text-[10px] px-2 py-1 rounded-md border transition ${filter === key ? "border-[#00a884]/50 bg-[#00a884]/10 text-[#008069]" : "border-slate-200 text-slate-500 hover:text-slate-900"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0">
          {convs.length === 0 ? (
            <EmptyState title="No conversations" hint="Dial a number in the Dialer, or wait for inbound WhatsApp messages and campaign replies — they open conversations automatically." />
          ) : (
            convs.map((c) => (
              <button key={c.id} onClick={() => setOpenConversationId(c.id)}
                className={`w-full text-left px-3 py-2.5 border-b border-slate-100 hover:bg-slate-50 transition ${openConversationId === c.id ? "bg-[#00a884]/[0.08]" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-900 truncate">
                    {leadName(c.lead)}
                    {c.channel === "facebook" && <span className="ml-1.5 text-[8px] font-bold uppercase rounded bg-[#1877f2] text-white px-1 py-0.5 align-middle">FB</span>}
                  </span>
                  {c.unreadCount > 0 && <span className="text-[9px] bg-[#00a884] text-white font-bold rounded-full px-1.5 min-w-4 text-center">{c.unreadCount}</span>}
                </div>
                <div className="text-[10px] text-slate-400 truncate mt-0.5">{c.lastMessagePreview || c.waPhone || "—"}</div>
                <div className="text-[9px] text-slate-400 mt-0.5">{c.lastMessageAt ? timeAgo(c.lastMessageAt) : ""}{c.assignedTo ? ` · ${c.assignedTo.name}` : ""}</div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Center: WhatsApp-style chat */}
      <ChatPanel
        detail={detail}
        loading={loading}
        leadName={lead ? leadName(lead) : (detail?.conversation.waPhone || "Select a conversation")}
        leadCompany={lead?.company || ""}
        optedOut={Boolean(lead?.optedOut)}
        onSendText={sendText}
        sending={sending}
        onSendTemplate={sendTemplate}
        tplSending={tplSending}
        error={error}
        windowClosedHint={windowClosedHint}
        className="h-full"
      />

      {/* Right: CRM profile */}
      {lead && detail && (
        <div className="hidden xl:block rounded-xl border border-slate-200 bg-white p-4 overflow-y-auto min-h-0">
          <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-3">CRM Profile</div>
          <div className="space-y-2.5 text-xs">
            <div className="flex justify-between"><span className="text-slate-400">Name</span><span className="text-slate-800">{leadName(lead)}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Company</span><span className="text-slate-800">{lead.company || "—"}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Country</span><span className="text-slate-800">{lead.country || "—"}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">WhatsApp</span><span className="text-slate-800 tabular-nums">{lead.whatsapp || "—"}</span></div>
            <div className="flex justify-between items-center"><span className="text-slate-400">Status</span><StatusPill status={lead.status} /></div>
            <div className="flex justify-between"><span className="text-slate-400">Score</span><span className="text-[#2563eb] font-semibold">{lead.score}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">Assigned</span><span className="text-slate-800">{detail.conversation.assignedTo?.name || "unassigned"}</span></div>
            <div className="pt-2 flex flex-wrap gap-1">
              {(JSON.parse(lead.tags || "[]") as string[]).map((t) => (
                <span key={t} className="text-[9px] px-1.5 py-0.5 rounded bg-slate-50 border border-slate-200 text-slate-500">{t}</span>
              ))}
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-200 text-[10px] text-slate-400 leading-relaxed">
            {detail.conversation.channel === "facebook"
              ? "Messages send through the Facebook Page (Messenger Send API). Free-form replies are deliverable inside the 24h standard messaging window opened by the customer's last message."
              : "Messages send through the Meta WhatsApp Cloud API. Free-form text is deliverable inside the 24h customer-service window; to start a chat use an approved template."}
          </div>
        </div>
      )}
    </div>
  );
}
