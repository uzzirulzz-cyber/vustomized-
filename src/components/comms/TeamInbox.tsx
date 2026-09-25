"use client";

// Team inbox (spec §15) — unassigned queue, presence board, assignment.
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/lp/api";
import { cn } from "@/lib/utils";
import type { LpUser } from "@/lib/lp/api";
import { Avatar, timeAgo } from "./shared";

type Conv = {
  id: string; waPhone: string | null; status: string; priority: string; unreadCount: number;
  lastMessageAt: string | null; lastMessagePreview: string | null;
  lead: { id: string; firstName: string | null; lastName: string | null; company: string | null; status: string; score: number };
  assignedTo: { id: string; name: string } | null;
  messages: { body: string; direction: string; createdAt: string }[];
};
type Member = { id: string; name: string; email: string; role: string; department: string | null; status: string; derivedOnline: boolean; openConversations: number; unreadConversations: number };

const STATUS_COLOR: Record<string, string> = { available: "#25d366", busy: "#f97316", on_call: "#fbbf24", away: "#94a3b8", offline: "#64748b" };

export default function TeamInbox({ user }: { user: LpUser }) {
  const [queue, setQueue] = useState<Conv[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([
        api<{ conversations: Conv[] }>("/api/lp/conversations?filter=unassigned"),
        api<{ members: Member[] }>("/api/lp/communications/presence"),
      ]);
      setQueue(c.conversations);
      setMembers(p.members);
    } catch { /* keep */ }
  }, []);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 15000); return () => clearInterval(t); }, [load]);

  const assignTo = async (convId: string, memberId: string, name: string) => {
    setBusy(convId);
    try {
      await api(`/api/lp/conversations/${convId}`, { method: "PATCH", body: JSON.stringify({ assignedToId: memberId, assignedName: name }) });
      await load();
    } catch { /* keep */ } finally { setBusy(""); }
  };

  const assignToMe = async (convId: string) => assignTo(convId, user.id, user.name);

  return (
    <div className="h-full overflow-y-auto comms-scroll p-4 lg:p-6">
      <div className="max-w-6xl mx-auto grid lg:grid-cols-[1fr_320px] gap-5 items-start">
        {/* unassigned queue */}
        <div className="comms-panel p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-base font-bold text-slate-100">Unassigned conversations</div>
              <div className="text-[11px] text-slate-500">Super admins and managers route these seats (spec §15) — assignment also reassigns the lead.</div>
            </div>
            <span className="comms-chip px-3 py-1 text-xs text-amber-300 font-semibold">{queue.length}</span>
          </div>
          {queue.length === 0 && <div className="py-8 text-center text-xs text-slate-500">Queue is clear — every open conversation has an owner.</div>}
          <div className="space-y-2">
            {queue.map((c) => {
              const name = `${c.lead.firstName || ""} ${c.lead.lastName || ""}`.trim() || c.waPhone || "Unknown";
              return (
                <div key={c.id} className="rounded-xl border border-[var(--cm-border)] p-3 flex items-center gap-3">
                  <Avatar name={name} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-100 truncate">{name}</span>
                      {c.unreadCount > 0 && <span className="text-[9px] bg-[#25d366] text-[#06281a] font-bold rounded-full px-1.5">{c.unreadCount}</span>}
                      {c.priority !== "normal" && <span className="text-[9px] text-orange-400 font-semibold uppercase">{c.priority}</span>}
                    </div>
                    <div className="text-[10px] text-slate-500 truncate mt-0.5">{c.lastMessagePreview || "—"} · {timeAgo(c.lastMessageAt)} ago</div>
                  </div>
                  <button onClick={() => void assignToMe(c.id)} disabled={busy === c.id}
                    className="h-8 px-3 rounded-lg comms-btn-primary text-white text-[10px] font-semibold transition disabled:opacity-50 shrink-0">
                    {busy === c.id ? "…" : "Assign to me"}
                  </button>
                  <select onChange={(e) => e.target.value && void assignTo(c.id, e.target.value, members.find((m) => m.id === e.target.value)?.name || "")} value=""
                    className="comms-input h-8 px-1.5 text-[10px] w-28 shrink-0" aria-label={`Assign ${name}`}>
                    <option value="">Assign to…</option>
                    {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
              );
            })}
          </div>
        </div>

        {/* presence board */}
        <div className="comms-panel p-4">
          <div className="text-base font-bold text-slate-100 mb-1">Team presence</div>
          <div className="text-[11px] text-slate-500 mb-3">Live heartbeats — agents choose their own availability.</div>
          <div className="space-y-1.5">
            {members.map((m) => (
              <div key={m.id} className="flex items-center gap-2.5 rounded-xl border border-[var(--cm-border)] p-2.5">
                <div className="relative">
                  <Avatar name={m.name} size={32} />
                  <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#0b1120]" style={{ backgroundColor: STATUS_COLOR[m.status] || "#64748b" }} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-slate-200 truncate">{m.name}{m.id === user.id ? " (you)" : ""}</div>
                  <div className="text-[10px] text-slate-500">{m.status.replace(/_/g, " ")}{m.derivedOnline ? " · online" : ""} · {m.openConversations} open</div>
                </div>
                {m.unreadConversations > 0 && <span className="text-[9px] bg-[#f97316]/20 text-[#fb923c] rounded-full px-1.5 py-0.5 font-semibold">{m.unreadConversations} unread</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
