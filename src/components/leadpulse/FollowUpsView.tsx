"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/lp/api";
import { SectionTitle, StatusPill, GoldButton, GhostButton, KpiCard, EmptyState } from "./bits";
import { leadName } from "./LeadsView";

type FollowUp = {
  id: string; dueAt: string; priority: string; status: string; notes: string | null;
  lead: { id: string; firstName: string | null; lastName: string | null; company: string | null; whatsapp: string | null; phone: string | null; email: string | null; country: string | null };
  owner?: { id: string; name: string } | null;
};

export default function FollowUpsView({ user, onChanged }: { user: { id: string; role: string }; onChanged?: () => void }) {
  const [scope, setScope] = useState<"overdue" | "today" | "upcoming" | "mine" | "all">("today");
  const [followups, setFollowups] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [newDate, setNewDate] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ followups: FollowUp[] }>(`/api/lp/followups?scope=${scope}`);
      setFollowups(data.followups);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => { void load(); }, [load]);

  const act = async (id: string, action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      await api(`/api/lp/followups/${id}`, { method: "PATCH", body: JSON.stringify({ action, ...extra }) });
      await load();
      onChanged?.();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const counts = {
    overdue: followups.filter((f) => new Date(f.dueAt) < new Date(new Date().setHours(0, 0, 0, 0))).length,
  };

  return (
    <div className="space-y-4">
      <SectionTitle right={
        <div className="flex flex-wrap gap-1">
          {(["overdue", "today", "upcoming", "mine", "all"] as const).map((s) => (
            <button key={s} onClick={() => setScope(s)}
              className={`text-[10px] px-2.5 py-1 rounded-md border transition capitalize ${scope === s ? "border-[#3d7ff7]/50 bg-[#3d7ff7]/10 text-[#2563eb]" : "border-slate-200 text-slate-500"}`}>
              {s}
            </button>
          ))}
        </div>
      }>
        Follow-ups
      </SectionTitle>

      {scope === "overdue" && counts.overdue > 0 && (
        <KpiCard label="Overdue follow-ups need action" value={counts.overdue} tone="danger" />
      )}

      <div className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
        {loading ? (
          <div className="px-3 py-10 text-center text-slate-400 text-xs">Loading…</div>
        ) : followups.length === 0 ? (
          <EmptyState title={`No ${scope} follow-ups`} hint="Schedule follow-ups from a lead profile or via bulk actions." />
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wider text-slate-400">
                <th className="px-3 py-2.5">Lead</th><th className="px-3 py-2.5">Due</th><th className="px-3 py-2.5">Priority</th>
                <th className="px-3 py-2.5">Owner</th><th className="px-3 py-2.5">Notes</th><th className="px-3 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {followups.map((f) => (
                <tr key={f.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2 text-slate-900">{leadName(f.lead)}</td>
                  <td className={`px-3 py-2 ${new Date(f.dueAt) < new Date() ? "text-rose-600" : "text-slate-800"}`}>
                    {new Date(f.dueAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2"><StatusPill status={f.priority} /></td>
                  <td className="px-3 py-2 text-slate-600">{f.owner?.name || "—"}</td>
                  <td className="px-3 py-2 text-slate-500 max-w-40 truncate">{f.notes || "—"}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <GhostButton disabled={busy} onClick={() => act(f.id, "complete")} className="!h-7 !px-2 mr-1.5">Complete</GhostButton>
                    <GhostButton disabled={busy} onClick={() => { setRescheduleId(f.id === rescheduleId ? null : f.id); setNewDate(""); }} className="!h-7 !px-2 mr-1.5">Reschedule</GhostButton>
                    {f.lead.whatsapp && (
                      <a href={`https://wa.me/${f.lead.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="text-emerald-600 text-xs hover:underline mr-1.5">Contact Now</a>
                    )}
                    {f.lead.phone && <a href={`tel:${f.lead.phone}`} className="text-slate-600 text-xs hover:underline">Call</a>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {rescheduleId && (
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <span className="text-xs text-slate-600">New date/time:</span>
          <input type="datetime-local" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="h-9 rounded-lg bg-slate-50 border border-slate-200 px-2 text-xs text-slate-900 [color-scheme:dark]" />
          <GoldButton disabled={busy || !newDate} onClick={() => { void act(rescheduleId, "reschedule", { dueAt: new Date(newDate).toISOString() }); setRescheduleId(null); }}>Save</GoldButton>
          <GhostButton onClick={() => setRescheduleId(null)}>Cancel</GhostButton>
        </div>
      )}
    </div>
  );
}
