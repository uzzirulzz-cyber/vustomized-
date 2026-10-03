"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/lp/api";
import { SectionTitle, KpiCard, StatusPill, GhostButton } from "./bits";

type Analytics = {
  days: number;
  leads: {
    importedLastPeriod: number; manualLastPeriod: number; contacted: number; qualified: number; converted: number;
    byStatus: { status: string; count: number }[];
    byCountry: { country: string | null; count: number }[];
    bySource: { source: string; count: number }[];
  };
  whatsapp: { sent: number; delivered: number; read: number; failed: number; replies: number; newConversations: number; optOuts: number };
  calls: { byStatus: Record<string, number>; total: number; avgDurationSec: number | null };
  employees: { id: string; name: string; role: string; department: string | null; leadsHandled: number; messages: number; calls: number; replies: number; conversions: number; followupsCompleted: number }[];
  campaigns: { id: string; name: string; status: string; recipients: number; deliveryRate: number; readRate: number; replyRate: number; conversionRate: number }[];
  daily: { date: string; inbound: number; outbound: number }[];
};

export default function AnalyticsView() {
  const [data, setData] = useState<Analytics | null>(null);
  const [days, setDays] = useState(14);

  const load = useCallback(async () => {
    setData(await api<Analytics>(`/api/lp/analytics?days=${days}`));
  }, [days]);

  useEffect(() => { void load(); }, [load]);

  if (!data) return <div className="p-6 text-sm text-slate-500">Loading analytics…</div>;
  const maxDaily = Math.max(1, ...data.daily.map((d) => d.inbound + d.outbound));

  return (
    <div className="space-y-5">
      <SectionTitle right={
        <div className="flex gap-1 items-center">
          <span className="text-[10px] text-slate-400 mr-1">period:</span>
          {[7, 14, 30, 90].map((d) => (
            <button key={d} onClick={() => setDays(d)}
              className={`text-[10px] px-2.5 py-1 rounded-md border transition ${days === d ? "border-[#3d7ff7]/50 bg-[#3d7ff7]/10 text-[#2563eb]" : "border-slate-200 text-slate-500"}`}>
              {d}d
            </button>
          ))}
          <GhostButton onClick={() => void load()} className="!h-7 ml-1">Refresh</GhostButton>
        </div>
      }>
        Analytics — computed from real database records (no fabricated values)
      </SectionTitle>

      {/* Lead analytics */}
      <div>
        <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">Lead Analytics</h3>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <KpiCard label={`Imported (${days}d)`} value={data.leads.importedLastPeriod} />
          <KpiCard label="Contacted" value={data.leads.contacted} />
          <KpiCard label="Qualified" value={data.leads.qualified} />
          <KpiCard label="Converted" value={data.leads.converted} tone="success" />
          <KpiCard label="Total pipeline" value={data.leads.byStatus.reduce((a, s) => (s.status !== "archived" ? a + s.count : a), 0)} />
        </div>
      </div>

      {/* Message volume chart */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-3">WhatsApp Analytics — daily volume</h3>
        <div className="flex items-end gap-1 h-28">
          {data.daily.map((d) => (
            <div key={d.date} className="flex-1 flex flex-col items-center gap-0.5 group relative">
              <div className="w-full flex flex-col justify-end h-24">
                {d.outbound > 0 && <div className="w-full bg-[#3d7ff7]/80 rounded-t-sm" style={{ height: `${(d.outbound / maxDaily) * 100}%` }} />}
                {d.inbound > 0 && <div className="w-full bg-emerald-500/70" style={{ height: `${(d.inbound / maxDaily) * 100}%` }} />}
              </div>
              <div className="absolute -top-7 hidden group-hover:block bg-white border border-slate-200 shadow-sm rounded px-1.5 py-0.5 text-[9px] text-slate-800 whitespace-nowrap z-10">
                ↑{d.outbound} ↓{d.inbound} · {d.date.slice(5)}
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-4 mt-2 text-[9px] text-slate-400">
          <span className="flex items-center gap-1"><span className="w-2 h-2 bg-[#3d7ff7]/80 rounded-sm" /> outbound ({data.whatsapp.sent})</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 bg-emerald-500/70 rounded-sm" /> inbound replies ({data.whatsapp.replies})</span>
          <span className="ml-auto">delivered {data.whatsapp.delivered} · read {data.whatsapp.read} · failed {data.whatsapp.failed} · opt-outs {data.whatsapp.optOuts} · new conversations {data.whatsapp.newConversations}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Calls */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-3">Call Analytics</h3>
          {data.calls.total === 0 ? (
            <div className="text-xs text-slate-400">No calls logged in this period.</div>
          ) : (
            <div className="space-y-2">
              {Object.entries(data.calls.byStatus).map(([status, count]) => (
                <div key={status} className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-600 w-24 capitalize">{status.replace(/_/g, " ")}</span>
                  <div className="flex-1 h-2 rounded-full bg-slate-50 overflow-hidden">
                    <div className="h-full bg-[#3d7ff7]/70 rounded-full" style={{ width: `${(count / data.calls.total) * 100}%` }} />
                  </div>
                  <span className="text-[11px] text-slate-500 tabular-nums w-8 text-right">{count}</span>
                </div>
              ))}
              <div className="text-[10px] text-slate-400 pt-1">
                Average duration: {data.calls.avgDurationSec != null
                  ? `${Math.floor(data.calls.avgDurationSec / 60)}m ${data.calls.avgDurationSec % 60}s`
                  : "unknown (no completed-call durations recorded)"}
              </div>
            </div>
          )}
        </div>

        {/* By country / source */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-3">Leads by Country & Source</h3>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {data.leads.byCountry.map((c) => (
              <span key={c.country} className="text-[10px] px-2 py-1 rounded border border-slate-200 bg-white text-slate-600">{c.country}: <b className="text-slate-900">{c.count}</b></span>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {data.leads.bySource.map((s) => (
              <span key={s.source} className="text-[10px] px-2 py-1 rounded border border-slate-200 bg-white text-slate-600">{s.source}: <b className="text-slate-900">{s.count}</b></span>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {data.leads.byStatus.map((s) => <StatusPill key={s.status} status={s.status} />)}
          </div>
        </div>
      </div>

      {/* Campaign analytics */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-3">Campaign Analytics</h3>
        {data.campaigns.length === 0 ? (
          <div className="text-xs text-slate-400">No campaigns yet.</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase text-slate-400 border-b border-slate-200">
                <th className="py-2">Campaign</th><th className="py-2">Status</th><th className="py-2">Recipients</th>
                <th className="py-2">Delivery</th><th className="py-2">Read</th><th className="py-2">Reply</th>
              </tr>
            </thead>
            <tbody>
              {data.campaigns.map((c) => (
                <tr key={c.id} className="border-b border-slate-100">
                  <td className="py-2 text-slate-900">{c.name}</td>
                  <td className="py-2"><StatusPill status={c.status} /></td>
                  <td className="py-2 text-slate-600 tabular-nums">{c.recipients}</td>
                  <td className="py-2 text-slate-600 tabular-nums">{c.deliveryRate}%</td>
                  <td className="py-2 text-slate-600 tabular-nums">{c.readRate}%</td>
                  <td className="py-2 text-slate-600 tabular-nums">{c.replyRate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Employee analytics */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-3">Employee Analytics ({days}d)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase text-slate-400 border-b border-slate-200">
                <th className="py-2">Employee</th><th className="py-2">Role</th><th className="py-2">Leads handled</th>
                <th className="py-2">Messages</th><th className="py-2">Calls</th><th className="py-2">Replies</th><th className="py-2">Conversions</th><th className="py-2">Follow-ups completed</th>
              </tr>
            </thead>
            <tbody>
              {data.employees.map((e) => (
                <tr key={e.id} className="border-b border-slate-100">
                  <td className="py-2 text-slate-900">{e.name}</td>
                  <td className="py-2 text-slate-500">{e.role.replace(/_/g, " ")}</td>
                  <td className="py-2 text-slate-800 tabular-nums">{e.leadsHandled}</td>
                  <td className="py-2 text-slate-800 tabular-nums">{e.messages}</td>
                  <td className="py-2 text-slate-800 tabular-nums">{e.calls}</td>
                  <td className="py-2 text-slate-800 tabular-nums">{e.replies}</td>
                  <td className="py-2 text-[#2563eb] tabular-nums font-semibold">{e.conversions}</td>
                  <td className="py-2 text-slate-800 tabular-nums">{e.followupsCompleted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
