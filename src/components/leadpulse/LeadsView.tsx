"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/lp/api";
import { KpiCard, SectionTitle, StatusPill, GoldButton, GhostButton, EmptyState, timeAgo } from "./bits";
import { LeadDetail } from "./LeadDetail";

export type LeadRow = {
  id: string; firstName: string | null; lastName: string | null; company: string | null;
  country: string | null; phone: string | null; whatsapp: string | null; email: string | null;
  status: string; score: number; tags: string; optedOut: boolean;
  lastContactAt: string | null; createdAt: string;
  source: string; industry: string | null; city: string | null; jobTitle: string | null;
  assignedTo?: { id: string; name: string } | null;
};

export const leadName = (l: { firstName?: string | null; lastName?: string | null; company?: string | null }) =>
  [l.firstName, l.lastName].filter(Boolean).join(" ") || l.company || "Unnamed lead";

const STATUSES = ["new", "contacted", "qualified", "converted", "do_not_contact", "archived"];

export default function LeadsView({ user, employees }: { user: { id: string; role: string; name: string }; employees: { id: string; name: string }[] }) {
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [hasWhatsapp, setHasWhatsapp] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openLeadId, setOpenLeadId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [showBulkPanel, setShowBulkPanel] = useState(false);
  const pageSize = 25;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (q) params.set("q", q);
      if (status) params.set("status", status);
      if (assignedTo) params.set("assignedTo", assignedTo);
      if (hasWhatsapp) params.set("hasWhatsapp", "1");
      const data = await api<{ total: number; leads: LeadRow[] }>(`/api/lp/leads?${params}`);
      setLeads(data.leads);
      setTotal(data.total);
    } catch { /* surfaced via empty state */ } finally {
      setLoading(false);
    }
  }, [page, q, status, assignedTo, hasWhatsapp]);

  useEffect(() => { load(); }, [load]);

  const toggle = (id: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const allSelected = leads.length > 0 && leads.every((l) => selected.has(l.id));

  const bulk = async (action: string, payload?: Record<string, unknown>) => {
    setBulkBusy(true);
    try {
      await api("/api/lp/leads/bulk", { method: "POST", body: JSON.stringify({ action, ids: [...selected], payload }) });
      setSelected(new Set());
      setShowBulkPanel(false);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Bulk action failed");
    } finally {
      setBulkBusy(false);
    }
  };

  const exportCsv = () => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    if (assignedTo) params.set("assignedTo", assignedTo);
    window.open(`/api/lp/leads/export?${params}`, "_blank");
  };

  const canBulk = ["super_admin", "admin", "manager"].includes(user.role);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }}
          placeholder="Search name, company, phone, email…"
          className="h-9 flex-1 min-w-52 rounded-lg bg-slate-50 border border-slate-200 px-3 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#3d7ff7]/60"
        />
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="h-9 rounded-lg bg-slate-50 border border-slate-200 px-2 text-xs text-slate-800 focus:outline-none">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
        </select>
        <select value={assignedTo} onChange={(e) => { setAssignedTo(e.target.value); setPage(1); }} className="h-9 rounded-lg bg-slate-50 border border-slate-200 px-2 text-xs text-slate-800 focus:outline-none">
          <option value="">Anyone</option>
          <option value="me">Assigned to me</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-slate-600 h-9 px-2 rounded-lg border border-slate-200 bg-slate-50 cursor-pointer">
          <input type="checkbox" checked={hasWhatsapp} onChange={(e) => { setHasWhatsapp(e.target.checked); setPage(1); }} className="accent-[#3d7ff7]" />
          WhatsApp available
        </label>
        <GhostButton onClick={exportCsv}>Export CSV</GhostButton>
        <GhostButton onClick={() => void load()}>Refresh</GhostButton>
      </div>

      {canBulk && selected.size > 0 && (
        <div className="rounded-xl border border-[#3d7ff7]/30 bg-[#3d7ff7]/[0.06] p-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-[#2563eb]">{selected.size} selected</span>
          <span className="text-[10px] text-slate-500 mr-2">Bulk Actions:</span>
          <select id="bulk-assignee" className="h-8 rounded-lg bg-slate-50 border border-slate-200 px-2 text-xs text-slate-800">
            <option value="">Assign to…</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <GhostButton disabled={bulkBusy} onClick={() => { const el = document.getElementById("bulk-assignee") as HTMLSelectElement; if (el?.value) bulk("assign", { assignedToId: el.value }); }}>Assign</GhostButton>
          <input id="bulk-tag" placeholder="Tag" className="h-8 w-24 rounded-lg bg-slate-50 border border-slate-200 px-2 text-xs text-slate-900" />
          <GhostButton disabled={bulkBusy} onClick={() => { const el = document.getElementById("bulk-tag") as HTMLInputElement; if (el?.value) bulk("addTag", { tag: el.value }); }}>Add Tag</GhostButton>
          <select id="bulk-status" className="h-8 rounded-lg bg-slate-50 border border-slate-200 px-2 text-xs text-slate-800">
            {STATUSES.filter((s) => s !== "archived").map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
          </select>
          <GhostButton disabled={bulkBusy} onClick={() => { const el = document.getElementById("bulk-status") as HTMLSelectElement; if (el?.value) bulk("status", { status: el.value }); }}>Set Status</GhostButton>
          <GhostButton disabled={bulkBusy} onClick={() => { const dt = new Date(Date.now() + 86400000).toISOString(); bulk("scheduleFollowUp", { dueAt: dt, priority: "normal" }); }}>Schedule Follow-up (tomorrow)</GhostButton>
          <GhostButton disabled={bulkBusy} onClick={() => bulk("doNotContact")} className="border-rose-400/40 text-rose-600">Do Not Contact</GhostButton>
          <GhostButton disabled={bulkBusy} onClick={() => bulk("archive")}>Archive</GhostButton>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-slate-50 backdrop-blur overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wider text-slate-400">
                {canBulk && (
                  <th className="px-3 py-2.5 w-8">
                    <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(leads.map((l) => l.id)))} className="accent-[#3d7ff7]" />
                  </th>
                )}
                <th className="px-3 py-2.5">Lead</th>
                <th className="px-3 py-2.5">Company</th>
                <th className="px-3 py-2.5">Country</th>
                <th className="px-3 py-2.5">WhatsApp</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Score</th>
                <th className="px-3 py-2.5">Assigned</th>
                <th className="px-3 py-2.5">Last Contact</th>
                <th className="px-3 py-2.5">Tags</th>
                <th className="px-3 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={11} className="px-3 py-10 text-center text-slate-400">Loading leads…</td></tr>
              ) : leads.length === 0 ? (
                <tr><td colSpan={11}><EmptyState title="No leads match" hint="Import a CSV or adjust the filters." /></td></tr>
              ) : (
                leads.map((l) => (
                  <tr key={l.id} className="border-b border-slate-100 hover:bg-slate-50 transition">
                    {canBulk && (
                      <td className="px-3 py-2">
                        <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} className="accent-[#3d7ff7]" />
                      </td>
                    )}
                    <td className="px-3 py-2">
                      <button onClick={() => setOpenLeadId(l.id)} className="text-left text-slate-900 font-medium hover:text-[#2563eb]">{leadName(l)}</button>
                      {l.optedOut && <span className="ml-1.5 text-[9px] text-rose-600 uppercase">opted out</span>}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{l.company || "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{l.country || "—"}</td>
                    <td className="px-3 py-2 text-slate-600 tabular-nums">{l.whatsapp || <span className="text-slate-400">—</span>}</td>
                    <td className="px-3 py-2"><StatusPill status={l.status} /></td>
                    <td className="px-3 py-2">
                      <span className={l.score >= 70 ? "text-emerald-600 font-semibold" : l.score >= 40 ? "text-amber-600" : "text-slate-500"}>{l.score}</span>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{l.assignedTo?.name || <span className="text-slate-400">unassigned</span>}</td>
                    <td className="px-3 py-2 text-slate-400">{l.lastContactAt ? timeAgo(l.lastContactAt) : "never"}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1 flex-wrap max-w-40">
                        {(JSON.parse(l.tags || "[]") as string[]).slice(0, 2).map((t) => (
                          <span key={t} className="text-[9px] px-1.5 py-0.5 rounded bg-slate-50 border border-slate-200 text-slate-500">{t}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button onClick={() => setOpenLeadId(l.id)} className="text-[#3d7ff7] hover:underline mr-2">Open</button>
                      {l.whatsapp && (
                        <a href={`https://wa.me/${l.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="text-emerald-600 hover:underline mr-2" title="Open WhatsApp (device action)">WA</a>
                      )}
                      {l.phone && <a href={`tel:${l.phone}`} className="text-slate-600 hover:underline" title="Click to Call (device action)">Call</a>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-3 py-2.5 border-t border-slate-200 text-[10px] text-slate-400">
          <span>{total.toLocaleString()} leads · page {page} of {Math.max(1, Math.ceil(total / pageSize))}</span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-2 py-1 rounded border border-slate-200 disabled:opacity-30 hover:bg-slate-50">Prev</button>
            <button disabled={page >= Math.ceil(total / pageSize)} onClick={() => setPage((p) => p + 1)} className="px-2 py-1 rounded border border-slate-200 disabled:opacity-30 hover:bg-slate-50">Next</button>
          </div>
        </div>
      </div>

      {openLeadId && (
        <LeadDetail
          leadId={openLeadId}
          user={user}
          employees={employees}
          onClose={() => setOpenLeadId(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}
