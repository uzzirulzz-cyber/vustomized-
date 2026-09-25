"use client";

// Communications dashboard — every KPI computed from stored data (spec §18).
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/lp/api";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, CartesianGrid } from "recharts";
import { Avatar, KpiCard, fmtDuration, timeAgo } from "./shared";

type Stats = {
  conversations: { total: number; open: number; unassigned: number; unread: number };
  messages: { today: number; avgFirstResponseSec: number | null };
  calls: { today: number; answered: number; missed: number; avgDurationSec: number | null; timedCount: number; outcomes: Record<string, number> };
  agents: { available: number; onCalls: number; total: number; activity: { id: string; name: string; role: string; presenceStatus: string | null; lastSeenAt: string | null; messagesSent7d: number; calls7d: number }[] };
  templates: { approved: number };
  leads: { converted: number; total: number; hot: number };
  series14d: { date: string; label: string; inbound: number; outbound: number; calls: number; answered: number }[];
};

const PIE_COLORS = ["#3d7ff7", "#25d366", "#fbbf24", "#f97316", "#8b5cf6", "#14b8a6", "#f87171", "#94a3b8"];

function ChartTooltip() {
  return <Tooltip contentStyle={{ background: "#0f1726", border: "1px solid rgba(148,163,184,0.25)", borderRadius: 12, fontSize: 11, color: "#e2e8f0" }} labelStyle={{ color: "#94a3b8" }} />;
}

export function CommsDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try { setStats(await api<Stats>("/api/lp/communications/stats")); setErr(""); }
    catch (e) { setErr(e instanceof Error ? e.message : "failed to load stats"); }
  }, []);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 20000); return () => clearInterval(t); }, [load]);

  if (err) return <div className="p-6 text-xs text-[#f87171]">{err}</div>;
  if (!stats) return <div className="h-full flex items-center justify-center text-xs text-slate-500 tracking-widest uppercase">Loading communications data…</div>;

  const waSeries = stats.series14d.map((d) => ({ name: d.label, inbound: d.inbound, outbound: d.outbound }));
  const callSeries = stats.series14d.map((d) => ({ name: d.label, calls: d.calls, answered: d.answered }));
  const outcomeData = Object.entries(stats.calls.outcomes).map(([k, v]) => ({ name: k.replace(/_/g, " "), value: v }));

  return (
    <div className="h-full overflow-y-auto comms-scroll p-4 lg:p-6 space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiCard label="WhatsApp Conversations" value={stats.conversations.total} sub={`${stats.conversations.open} open · ${stats.conversations.unassigned} unassigned`} accent="#25d366" icon={<span>✆</span>} />
        <KpiCard label="Unread Messages" value={stats.conversations.unread} sub={`${stats.messages.today} messages today`} accent="#f97316" icon={<span>✉</span>} />
        <KpiCard label="Calls Today" value={stats.calls.today} sub={`${stats.calls.answered} answered · ${stats.calls.missed} missed`} accent="#3d7ff7" icon={<span>☏</span>} />
        <KpiCard label="Avg Call Duration" value={stats.calls.avgDurationSec != null ? fmtDuration(stats.calls.avgDurationSec) : "—"} sub={`${stats.calls.timedCount} timed calls`} accent="#8b5cf6" icon={<span>◷</span>} />
        <KpiCard label="Agents Available" value={`${stats.agents.available}/${stats.agents.total}`} sub={`${stats.agents.onCalls} on calls now`} accent="#fbbf24" icon={<span>øy</span>} />
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <div className="comms-panel p-4">
          <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500 mb-3">WhatsApp volume — 14 days</div>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={waSeries} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                <defs>
                  <linearGradient id="gIn" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#25d366" stopOpacity={0.5} /><stop offset="100%" stopColor="#25d366" stopOpacity={0.03} /></linearGradient>
                  <linearGradient id="gOut" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3d7ff7" stopOpacity={0.5} /><stop offset="100%" stopColor="#3d7ff7" stopOpacity={0.03} /></linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(148,163,184,0.1)" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: "#64748b", fontSize: 9 }} interval={2} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <ChartTooltip />
                <Area type="monotone" dataKey="inbound" stroke="#25d366" fill="url(#gIn)" strokeWidth={2} name="Inbound" />
                <Area type="monotone" dataKey="outbound" stroke="#3d7ff7" fill="url(#gOut)" strokeWidth={2} name="Outbound" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="comms-panel p-4">
          <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500 mb-3">Calls by day — 14 days</div>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={callSeries} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="rgba(148,163,184,0.1)" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: "#64748b", fontSize: 9 }} interval={2} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <ChartTooltip />
                <Bar dataKey="calls" fill="#3d7ff7" radius={[4, 4, 0, 0]} name="Placed" />
                <Bar dataKey="answered" fill="#25d366" radius={[4, 4, 0, 0]} name="Answered" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="comms-panel p-4">
          <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500 mb-3">Call outcomes</div>
          {outcomeData.length === 0 ? (
            <div className="h-52 flex items-center justify-center text-xs text-slate-500">No call outcomes recorded yet — outcomes appear once calls are dispositioned.</div>
          ) : (
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={outcomeData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={72} paddingAngle={3}>
                    {outcomeData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke="rgba(8,12,22,0.8)" />)}
                  </Pie>
                  <ChartTooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-2 justify-center -mt-8 pb-1">
                {outcomeData.map((o, i) => (
                  <span key={o.name} className="text-[10px] text-slate-400 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />{o.name} ({o.value})
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="comms-panel p-4">
          <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500 mb-3">Pipeline & response</div>
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-xl border border-[var(--cm-border)] p-3">
              <div className="text-xl font-bold text-slate-100">{stats.leads.converted}</div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mt-1">Converted leads</div>
              <div className="text-[10px] text-slate-600">of {stats.leads.total} active</div>
            </div>
            <div className="rounded-xl border border-[var(--cm-border)] p-3">
              <div className="text-xl font-bold text-slate-100">{stats.leads.hot}</div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mt-1">Hot leads (70+)</div>
              <div className="text-[10px] text-slate-600">ready for outreach</div>
            </div>
            <div className="rounded-xl border border-[var(--cm-border)] p-3">
              <div className="text-xl font-bold text-slate-100">{stats.messages.avgFirstResponseSec != null ? `${Math.max(1, Math.round(stats.messages.avgFirstResponseSec / 60))}m` : "—"}</div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mt-1">Avg first response</div>
              <div className="text-[10px] text-slate-600">inbound → agent reply</div>
            </div>
            <div className="rounded-xl border border-[var(--cm-border)] p-3">
              <div className="text-xl font-bold text-slate-100">{stats.templates.approved}</div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mt-1">Approved templates</div>
              <div className="text-[10px] text-slate-600">Meta-verified, deliverable</div>
            </div>
          </div>
        </div>
      </div>

      {/* agent activity */}
      <div className="comms-panel p-4">
        <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500 mb-3">Agent activity — last 7 days</div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {stats.agents.activity.map((a) => (
            <div key={a.id} className="rounded-xl border border-[var(--cm-border)] p-3 flex items-center gap-3">
              <Avatar name={a.name} size={36} />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-slate-200 truncate">{a.name}</div>
                <div className="text-[10px] text-slate-500">{a.messagesSent7d} messages · {a.calls7d} calls</div>
                <div className="text-[9px] text-slate-600 mt-0.5">
                  {a.presenceStatus ? a.presenceStatus.replace(/_/g, " ") : "no status"}{a.lastSeenAt ? ` · seen ${timeAgo(a.lastSeenAt)} ago` : ""}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function CommsAnalytics() {
  return (
    <div className="h-full overflow-y-auto comms-scroll">
      <CommsDashboard />
    </div>
  );
}
