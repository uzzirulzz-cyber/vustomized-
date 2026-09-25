"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/lp/api";
import { StatusPill, GoldButton, GhostButton, timeAgo } from "./bits";

type Lead = {
  id: string; firstName: string | null; lastName: string | null; company: string | null;
  jobTitle: string | null; country: string | null; state: string | null; city: string | null;
  address: string | null; website: string | null; email: string | null; whatsapp: string | null;
  phone: string | null; industry: string | null; status: string; score: number; tags: string;
  optedOut: boolean; lastContactAt: string | null; assignedToId: string | null;
  assignedTo?: { id: string; name: string } | null;
};
type Activity = { id: string; type: string; title: string; detail: string | null; createdAt: string; actor?: { name: string } | null };
type Note = { id: string; body: string; createdAt: string; author?: { name: string } | null };
type Conv = { id: string; waPhone: string | null; lastMessagePreview: string | null; lastMessageAt: string | null; unreadCount: number };
type Call = { id: string; status: string; outcome: string | null; method: string; durationSec: number | null; createdAt: string };
type FollowUp = { id: string; dueAt: string; priority: string; status: string; notes: string | null };

const ACTIVITY_META: Record<string, { icon: string; color: string }> = {
  lead_imported: { icon: "⇪", color: "text-slate-500" },
  lead_created: { icon: "＋", color: "text-sky-600" },
  assigned: { icon: "→", color: "text-violet-600" },
  conversation_started: { icon: "◉", color: "text-emerald-600" },
  message_sent: { icon: "↗", color: "text-sky-600" },
  message_received: { icon: "↙", color: "text-[#2563eb]" },
  call_logged: { icon: "☏", color: "text-teal-600" },
  note_added: { icon: "✎", color: "text-slate-600" },
  followup_scheduled: { icon: "⏰", color: "text-amber-600" },
  followup_completed: { icon: "✓", color: "text-emerald-600" },
  status_changed: { icon: "≡", color: "text-violet-600" },
  campaign_sent: { icon: "⚡", color: "text-[#2563eb]" },
  opt_out: { icon: "⊘", color: "text-rose-600" },
  converted: { icon: "★", color: "text-emerald-600" },
};

export function LeadDetail({
  leadId, user, employees, onClose, onChanged, onOpenConversation,
}: {
  leadId: string;
  user: { id: string; role: string };
  employees: { id: string; name: string }[];
  onClose: () => void;
  onChanged?: () => void;
  onOpenConversation?: (conversationId: string) => void;
}) {
  const [data, setData] = useState<{
    lead: Lead; activities: Activity[]; notes: Note[]; conversations: Conv[]; calls: Call[]; followups: FollowUp[];
  } | null>(null);
  const [tab, setTab] = useState<"timeline" | "notes" | "activity">("timeline");
  const [noteDraft, setNoteDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [followupDate, setFollowupDate] = useState("");
  const [logCallOpen, setLogCallOpen] = useState(false);
  const [callForm, setCallForm] = useState({ status: "completed", outcome: "interested", durationMin: "", durationSec: "", notes: "", method: "device_dialer" });

  const load = useCallback(async () => {
    setData(await api(`/api/lp/leads/${leadId}`));
  }, [leadId]);

  useEffect(() => { void load(); }, [load]);

  if (!data) return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="text-sm text-slate-500">Loading lead…</div>
    </div>
  );

  const { lead, activities, notes, conversations, calls, followups } = data;
  const tags: string[] = JSON.parse(lead.tags || "[]");

  const patchLead = async (patch: Record<string, unknown>) => {
    setBusy(true);
    try {
      await api(`/api/lp/leads/${leadId}`, { method: "PATCH", body: JSON.stringify(patch) });
      await load();
      onChanged?.();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  };

  const addNote = async () => {
    if (!noteDraft.trim()) return;
    setBusy(true);
    try {
      await api(`/api/lp/leads/${leadId}/notes`, { method: "POST", body: JSON.stringify({ body: noteDraft }) });
      setNoteDraft("");
      setTab("notes");
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not add note");
    } finally {
      setBusy(false);
    }
  };

  const scheduleFollowUp = async () => {
    if (!followupDate) return;
    setBusy(true);
    try {
      await api("/api/lp/followups", { method: "POST", body: JSON.stringify({ leadId, dueAt: new Date(followupDate).toISOString(), priority: "normal" }) });
      setFollowupDate("");
      await load();
      onChanged?.();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not schedule");
    } finally {
      setBusy(false);
    }
  };

  const logCall = async () => {
    setBusy(true);
    try {
      const durationSec = callForm.status === "completed"
        ? (Number(callForm.durationMin || 0) * 60 + Number(callForm.durationSec || 0))
        : null;
      if (callForm.status === "completed" && durationSec <= 0) {
        alert("A COMPLETED call requires the real duration — enter minutes/seconds, or set status to 'no_answer'.");
        setBusy(false);
        return;
      }
      await api("/api/lp/calls", {
        method: "POST",
        body: JSON.stringify({
          leadId, status: callForm.status, outcome: callForm.outcome, method: callForm.method,
          durationSec: durationSec || null, notes: callForm.notes || null,
        }),
      });
      setLogCallOpen(false);
      setCallForm({ status: "completed", outcome: "interested", durationMin: "", durationSec: "", notes: "", method: "device_dialer" });
      await load();
      onChanged?.();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not log call");
    } finally {
      setBusy(false);
    }
  };

  const waHref = lead.whatsapp ? `https://wa.me/${lead.whatsapp.replace(/\D/g, "")}` : null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex justify-end" onClick={onClose}>
      <div className="w-full max-w-2xl h-full bg-[#ffffff] border-l border-slate-200 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 z-10 bg-[#ffffff]/95 backdrop-blur border-b border-slate-200 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-slate-900">
                  {[lead.firstName, lead.lastName].filter(Boolean).join(" ") || lead.company || "Unnamed lead"}
                </h3>
                <StatusPill status={lead.status} />
                {lead.optedOut && <StatusPill status="do_not_contact" />}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                {lead.jobTitle ? `${lead.jobTitle} · ` : ""}{lead.company || "—"}{lead.city ? ` · ${lead.city}` : ""}{lead.country ? `, ${lead.country}` : ""}
              </div>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-900 text-lg leading-none">×</button>
          </div>

          {/* Quick actions (spec §23: Call → WhatsApp → Email → Note → Follow-up) */}
          <div className="flex flex-wrap gap-2 mt-3">
            <GhostButton onClick={() => setLogCallOpen((v) => !v)}>Log Call</GhostButton>
            {waHref ? (
              <a href={waHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600/80 hover:bg-emerald-500 text-slate-900 text-xs font-semibold px-3 h-9 transition">
                Open WhatsApp <span className="text-[9px] opacity-70">(device)</span>
              </a>
            ) : (
              <span className="text-[10px] text-slate-400 self-center">no WhatsApp number</span>
            )}
            {lead.email && <a href={`mailto:${lead.email}`} className="inline-flex items-center rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-800 text-xs px-3 h-9">Email</a>}
            <select
              value={lead.assignedToId || ""} disabled={busy}
              onChange={(e) => patchLead({ assignedToId: e.target.value || null })}
              className="h-9 rounded-lg bg-slate-50 border border-slate-200 px-2 text-xs text-slate-800"
            >
              <option value="">Unassigned</option>
              {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
            </select>
            <select
              value={lead.status} disabled={busy}
              onChange={(e) => patchLead({ status: e.target.value })}
              className="h-9 rounded-lg bg-slate-50 border border-slate-200 px-2 text-xs text-slate-800"
            >
              {["new", "contacted", "qualified", "converted", "do_not_contact", "archived"].map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
            </select>
          </div>

          {/* Log call form */}
          {logCallOpen && (
            <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">Log call activity — honest record (§9)</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <select value={callForm.status} onChange={(e) => setCallForm((f) => ({ ...f, status: e.target.value }))} className="h-8 rounded bg-slate-50 border border-slate-200 px-2 text-xs text-slate-800">
                  {["completed", "missed", "busy", "no_answer", "failed", "scheduled"].map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                </select>
                <select value={callForm.outcome} onChange={(e) => setCallForm((f) => ({ ...f, outcome: e.target.value }))} className="h-8 rounded bg-slate-50 border border-slate-200 px-2 text-xs text-slate-800">
                  {["interested", "not_interested", "callback_requested", "qualified", "converted", "wrong_number", "do_not_contact", "pending"].map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                </select>
                <select value={callForm.method} onChange={(e) => setCallForm((f) => ({ ...f, method: e.target.value }))} className="h-8 rounded bg-slate-50 border border-slate-200 px-2 text-xs text-slate-800">
                  <option value="device_dialer">device dialer (tel:)</option>
                  <option value="whatsapp_open">WhatsApp call (manual)</option>
                </select>
                <div className="flex gap-1">
                  <input value={callForm.durationMin} onChange={(e) => setCallForm((f) => ({ ...f, durationMin: e.target.value }))} placeholder="min" inputMode="numeric" className="h-8 w-full rounded bg-slate-50 border border-slate-200 px-2 text-xs text-slate-900" />
                  <input value={callForm.durationSec} onChange={(e) => setCallForm((f) => ({ ...f, durationSec: e.target.value }))} placeholder="sec" inputMode="numeric" className="h-8 w-full rounded bg-slate-50 border border-slate-200 px-2 text-xs text-slate-900" />
                </div>
              </div>
              <input value={callForm.notes} onChange={(e) => setCallForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Call notes…" className="w-full h-8 rounded bg-slate-50 border border-slate-200 px-2 text-xs text-slate-900" />
              <div className="flex justify-end gap-2">
                <GhostButton onClick={() => setLogCallOpen(false)}>Cancel</GhostButton>
                <GoldButton disabled={busy} onClick={logCall}>Save Call Record</GoldButton>
              </div>
            </div>
          )}
        </div>

        {/* Contact info */}
        <div className="p-4 border-b border-slate-200 grid grid-cols-2 gap-3 text-xs">
          <div><span className="text-slate-400">WhatsApp:</span> <span className="text-slate-800 tabular-nums">{lead.whatsapp || "—"}</span></div>
          <div><span className="text-slate-400">Phone:</span> <span className="text-slate-800 tabular-nums">{lead.phone || "—"}</span></div>
          <div className="truncate"><span className="text-slate-400">Email:</span> <span className="text-slate-800">{lead.email || "—"}</span></div>
          <div><span className="text-slate-400">Score:</span> <span className="text-[#2563eb] font-semibold">{lead.score}</span></div>
          <div className="truncate"><span className="text-slate-400">Industry:</span> <span className="text-slate-800">{lead.industry || "—"}</span></div>
          <div><span className="text-slate-400">Last contact:</span> <span className="text-slate-800">{lead.lastContactAt ? timeAgo(lead.lastContactAt) : "never"}</span></div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 text-xs">
          {(["timeline", "notes", "activity"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2.5 capitalize ${tab === t ? "text-[#2563eb] border-b-2 border-[#3d7ff7]" : "text-slate-500 hover:text-slate-900"}`}>
              {t === "activity" ? `Conversations & Follow-ups` : t}
            </button>
          ))}
        </div>

        <div className="p-4">
          {tab === "timeline" && (
            <div className="space-y-0">
              {[...activities].reverse().map((a, idx) => {
                const meta = ACTIVITY_META[a.type] || { icon: "·", color: "text-slate-500" };
                return (
                  <div key={a.id} className="flex gap-3 relative pb-4 last:pb-0">
                    {idx < activities.length - 1 && <div className="absolute left-[11px] top-6 bottom-0 w-px bg-slate-100" />}
                    <div className={`w-6 h-6 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center text-[10px] shrink-0 ${meta.color}`}>{meta.icon}</div>
                    <div className="min-w-0">
                      <div className="text-xs text-slate-800">{a.title}</div>
                      <div className="text-[10px] text-slate-400">
                        {new Date(a.createdAt).toLocaleString()} {a.actor ? `· ${a.actor.name}` : ""}
                      </div>
                    </div>
                  </div>
                );
              })}
              {activities.length === 0 && <div className="text-xs text-slate-400">No timeline entries yet.</div>}
            </div>
          )}

          {tab === "notes" && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="Add a note to this lead…" className="flex-1 h-9 rounded-lg bg-slate-50 border border-slate-200 px-3 text-xs text-slate-900" />
                <GoldButton disabled={busy || !noteDraft.trim()} onClick={addNote}>Add Note</GoldButton>
              </div>
              {notes.length === 0 ? (
                <div className="text-xs text-slate-400">No notes yet.</div>
              ) : (
                notes.map((n) => (
                  <div key={n.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs text-slate-800 whitespace-pre-wrap">{n.body}</div>
                    <div className="text-[10px] text-slate-400 mt-1.5">{n.author?.name || "System"} · {timeAgo(n.createdAt)}</div>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === "activity" && (
            <div className="space-y-4">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-2">WhatsApp conversations</div>
                {conversations.length === 0 ? (
                  <div className="text-xs text-slate-400">No conversations yet.</div>
                ) : (
                  conversations.map((c) => (
                    <button key={c.id} onClick={() => onOpenConversation?.(c.id)} className="w-full text-left rounded-lg border border-slate-200 bg-slate-50 p-3 mb-2 hover:border-[#3d7ff7]/40 transition">
                      <div className="flex justify-between"><span className="text-xs text-slate-900 tabular-nums">{c.waPhone}</span>{c.unreadCount > 0 && <span className="text-[10px] text-[#2563eb]">{c.unreadCount} unread</span>}</div>
                      <div className="text-[11px] text-slate-500 truncate mt-1">{c.lastMessagePreview || "—"}</div>
                    </button>
                  ))
                )}
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-2">Follow-ups</div>
                {followups.length === 0 ? (
                  <div className="text-xs text-slate-400">None scheduled.</div>
                ) : (
                  followups.map((f) => (
                    <div key={f.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 mb-2 flex items-center justify-between">
                      <div>
                        <div className="text-xs text-slate-900">{new Date(f.dueAt).toLocaleString()}</div>
                        {f.notes && <div className="text-[10px] text-slate-400">{f.notes}</div>}
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusPill status={f.priority} />
                        <StatusPill status={f.status} />
                      </div>
                    </div>
                  ))
                )}
                <div className="flex gap-2 mt-2">
                  <input type="datetime-local" value={followupDate} onChange={(e) => setFollowupDate(e.target.value)} className="flex-1 h-9 rounded-lg bg-slate-50 border border-slate-200 px-2 text-xs text-slate-900 [color-scheme:dark]" />
                  <GoldButton disabled={busy || !followupDate} onClick={scheduleFollowUp}>Schedule</GoldButton>
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-2">Calls</div>
                {calls.length === 0 ? (
                  <div className="text-xs text-slate-400">No call records.</div>
                ) : (
                  calls.map((c) => (
                    <div key={c.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 mb-2 flex items-center justify-between">
                      <div className="text-xs text-slate-800 capitalize">{c.status.replace(/_/g, " ")} · {c.method.replace(/_/g, " ")}</div>
                      <div className="text-[10px] text-slate-400">{c.durationSec != null ? `${Math.floor(c.durationSec / 60)}m ${c.durationSec % 60}s · ` : ""}{c.outcome ? c.outcome.replace(/_/g, " ") : ""} · {timeAgo(c.createdAt)}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
