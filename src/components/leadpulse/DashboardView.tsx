"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/lp/api";
import { KpiCard, SectionTitle, StatusPill, timeAgo, EmptyState } from "./bits";
import type { View } from "./page";

type Dashboard = {
  kpis: {
    totalLeads: number; newLeads: number; assignedLeads: number; contactedLeads: number;
    whatsappConversations: number; callsToday: number; messagesSent: number;
    messagesDelivered: number; replies: number; followupsDue: number;
    overdueFollowups: number; convertedCustomers: number; optOuts: number;
  };
  feed: { id: string; title: string; actorName: string; type: string; leadName: string | null; createdAt: string }[];
  campaignStats: { id: string; name: string; status: string; recipients: number; sent: number; delivered: number; read: number; failed: number; replies: number }[];
  employeeActivity: { id: string; name: string; department: string | null; messages: number; calls: number; followupsCompleted: number }[];
};

export default function DashboardView({ go }: { go: (v: View) => void }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api<Dashboard>("/api/lp/dashboard"));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard");
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  if (error) return <div className="text-sm text-rose-600 p-6">{error}</div>;
  if (!data) return <div className="p-6 text-sm text-slate-500">Loading dashboard…</div>;
  const { kpis } = data;

  return (
    <div className="space-y-6">
      {/* KPI grid */}
      <div>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-900">Dashboard Overview</h2>
          <span className="text-[10px] text-slate-400">auto-refreshes every 15s · live database values</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard label="Total Leads" value={kpis.totalLeads} sub={`${kpis.newLeads} new`} />
          <KpiCard label="Assigned Leads" value={kpis.assignedLeads} />
          <KpiCard label="Contacted Leads" value={kpis.contactedLeads} />
          <KpiCard label="WhatsApp Conversations" value={kpis.whatsappConversations} tone="gold" />
          <KpiCard label="Calls Today" value={kpis.callsToday} />
          <KpiCard label="Messages Sent" value={kpis.messagesSent} sub={`${kpis.messagesDelivered} delivered`} />
          <KpiCard label="Replies" value={kpis.replies} tone="gold" />
          <KpiCard label="Follow-ups Due" value={kpis.followupsDue} sub={`${kpis.overdueFollowups} overdue`} tone={kpis.overdueFollowups > 0 ? "danger" : "default"} />
          <KpiCard label="Converted Customers" value={kpis.convertedCustomers} tone="success" />
          <KpiCard label="Opt-outs (suppressed)" value={kpis.optOuts} tone={kpis.optOuts > 0 ? "danger" : "default"} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Live activity feed */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 backdrop-blur p-4">
          <SectionTitle right={<button onClick={() => go("inbox")} className="text-[10px] text-[#3d7ff7] hover:underline">Open Inbox →</button>}>
            Live Activity Feed
          </SectionTitle>
          {data.feed.length === 0 ? (
            <EmptyState title="No activity yet" hint="Import leads, start conversations or log calls — events appear here in real time." />
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {data.feed.map((f) => (
                <div key={f.id} className="flex items-start gap-2.5 text-xs">
                  <span className="mt-1 w-1.5 h-1.5 rounded-full bg-[#3d7ff7]/70 shrink-0" />
                  <div className="min-w-0">
                    <span className="text-slate-600">
                      <span className="text-slate-900 font-medium">{f.actorName}</span> — {f.title}
                      {f.leadName ? <span className="text-slate-400"> ({f.leadName})</span> : null}
                    </span>
                    <span className="text-slate-400 ml-1.5">· {timeAgo(f.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Campaign performance */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 backdrop-blur p-4">
          <SectionTitle right={<button onClick={() => go("campaigns")} className="text-[10px] text-[#3d7ff7] hover:underline">All Campaigns →</button>}>
            Campaign Performance
          </SectionTitle>
          {data.campaignStats.length === 0 ? (
            <EmptyState title="No campaigns yet" hint="Create a campaign from the Leads view or the Campaigns module." />
          ) : (
            <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
              {data.campaignStats.map((c) => (
                <div key={c.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-slate-900 truncate">{c.name}</span>
                    <StatusPill status={c.status} />
                  </div>
                  <div className="grid grid-cols-6 gap-2 text-center">
                    {([["Recip", c.recipients], ["Sent", c.sent], ["Deliv", c.delivered], ["Read", c.read], ["Failed", c.failed], ["Replies", c.replies]] as const).map(([label, v]) => (
                      <div key={label}>
                        <div className="text-xs font-semibold text-slate-800 tabular-nums">{v}</div>
                        <div className="text-[9px] text-slate-400 uppercase">{label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Employee activity */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 backdrop-blur p-4">
        <SectionTitle right={<button onClick={() => go("employees")} className="text-[10px] text-[#3d7ff7] hover:underline">Manage Team →</button>}>
          Employee Activity
        </SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.employeeActivity.map((e) => (
            <div key={e.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-xs font-medium text-slate-900 truncate">{e.name}</div>
                <div className="text-[10px] text-slate-400">{e.department || "—"}</div>
              </div>
              <div className="flex gap-3 text-center">
                <div><div className="text-xs font-semibold text-[#2563eb] tabular-nums">{e.messages}</div><div className="text-[9px] text-slate-400 uppercase">msgs</div></div>
                <div><div className="text-xs font-semibold text-slate-800 tabular-nums">{e.calls}</div><div className="text-[9px] text-slate-400 uppercase">calls</div></div>
                <div><div className="text-xs font-semibold text-slate-800 tabular-nums">{e.followupsCompleted}</div><div className="text-[9px] text-slate-400 uppercase">done</div></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
