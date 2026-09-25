"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { api, tryRestore, logout, type LpUser } from "@/lib/lp/api";
import LoginView from "@/components/leadpulse/LoginView";
import DashboardView from "@/components/leadpulse/DashboardView";
import LeadsView from "@/components/leadpulse/LeadsView";
import ImportView from "@/components/leadpulse/ImportView";
import InboxView from "@/components/leadpulse/InboxView";
import DialerView from "@/components/leadpulse/DialerView";
import CallsView from "@/components/leadpulse/CallsView";
import CampaignsView from "@/components/leadpulse/CampaignsView";
import TemplatesView from "@/components/leadpulse/TemplatesView";
import FollowUpsView from "@/components/leadpulse/FollowUpsView";
import EmployeesView from "@/components/leadpulse/EmployeesView";
import AnalyticsView from "@/components/leadpulse/AnalyticsView";
import IntegrationsView from "@/components/leadpulse/IntegrationsView";
import SettingsView from "@/components/leadpulse/SettingsView";
import { GoldButton } from "@/components/leadpulse/bits";

export type View =
  | "dashboard" | "leads" | "leads-mine" | "import" | "inbox" | "dialer" | "calls"
  | "campaigns" | "templates" | "followups" | "employees" | "analytics"
  | "integrations" | "settings";

const NAV: { group: string; items: { key: View | "comms-center"; label: string }[] }[] = [
  { group: "", items: [{ key: "dashboard", label: "Dashboard" }] },
  {
    group: "Leads",
    items: [
      { key: "leads", label: "All Leads" },
      { key: "import", label: "Import CSV" },
      { key: "leads-mine", label: "My Leads" },
    ],
  },
  {
    group: "Communications",
    items: [
      { key: "inbox", label: "Messages (WhatsApp)" },
      { key: "dialer", label: "Dialer" },
      { key: "calls", label: "Calls" },
      { key: "comms-center", label: "Communications Center ⚡" },
    ],
  },
  {
    group: "Campaigns",
    items: [
      { key: "campaigns", label: "All Campaigns" },
      { key: "templates", label: "Templates" },
    ],
  },
  { group: "", items: [{ key: "followups", label: "Follow-ups" }] },
  { group: "", items: [{ key: "employees", label: "Employees" }] },
  { group: "", items: [{ key: "analytics", label: "Analytics" }] },
  { group: "", items: [{ key: "integrations", label: "Integrations" }] },
  { group: "Settings", items: [{ key: "settings", label: "Compliance & Audit" }] },
];

export default function Page() {
  const [booted, setBooted] = useState(false);
  const [user, setUser] = useState<LpUser | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([]);
  const [openConversationId, setOpenConversationId] = useState<string | null>(null);
  const [liveEvents, setLiveEvents] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  // restore session
  useEffect(() => {
    tryRestore()
      .then((u) => setUser(u))
      .catch(() => setUser(null))
      .finally(() => setBooted(true));
  }, []);

  // hash-synced view
  useEffect(() => {
    const applyHash = () => {
      const h = window.location.hash.replace("#/", "") as View;
      if (h) setView(h);
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);

  const go = useCallback((v: View) => {
    setView(v);
    window.location.hash = `/${v}`;
    if (v !== "inbox") setOpenConversationId(null);
  }, []);

  // load employees for filters/assignment
  const loadEmployees = useCallback(async () => {
    if (!user) return;
    try {
      const data = await api<{ employees: { id: string; name: string }[] }>("/api/lp/employees");
      setEmployees(data.employees.map((e) => ({ id: e.id, name: e.name })));
    } catch { /* viewer role may lack access — fine */ }
  }, [user]);

  useEffect(() => { void loadEmployees(); }, [loadEmployees, view]);

  // realtime socket (mini-service, via gateway).
  // Serverless hosts (Vercel) have no reachable child-process port — the sandbox
  // gateway trick (?XTransformPort=3003) only exists on *.space-z.ai/localhost,
  // so connect only there. On other hosts the UI degrades gracefully
  // (dashboard/campaign views still auto-refresh on their own timers).
  useEffect(() => {
    if (!user) return;
    const h = typeof location !== "undefined" ? location.hostname : "";
    const realtimeCapable = h === "localhost" || h === "127.0.0.1" || h.endsWith(".space-z.ai");
    if (!realtimeCapable) return;
    const socket = io("/?XTransformPort=3003", { path: "/" });
    socketRef.current = socket;
    socket.on("activity", (payload: { title: string; actorName: string }) => {
      setLiveEvents((n) => n + 1);
      setToast(`${payload.actorName} — ${payload.title}`);
      setTimeout(() => setToast(null), 4000);
    });
    socket.on("campaign_progress", () => setLiveEvents((n) => n + 1));
    return () => { socket.disconnect(); socketRef.current = null; };
  }, [user]);

  const doLogout = async () => {
    await logout();
    setUser(null);
    setView("dashboard");
  };

  if (!booted) {
    return (
      <div className="min-h-screen bg-[#eef1f7] flex items-center justify-center">
        <div className="text-sm text-slate-400 tracking-widest uppercase">Lead Pulse · loading…</div>
      </div>
    );
  }

  if (!user) {
    return <LoginView onLoggedIn={() => { tryRestore().then((u) => u && setUser(u)); }} />;
  }

  const refreshedUser = user;

  return (
    <div className="min-h-screen flex bg-[#eef1f7] text-slate-800">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r border-slate-200 bg-white backdrop-blur flex flex-col sticky top-0 h-screen">
        <div className="p-4 border-b border-slate-200">
          <div className="text-sm font-bold tracking-wide text-slate-900">
            PLAYBEAT <span className="text-[#2563eb]">LEAD PULSE</span>
          </div>
          <div className="text-[9px] text-slate-400 uppercase tracking-wider mt-0.5">Enterprise CRM · v1.0</div>
        </div>

        <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-1 [font-family:var(--font-raleway)]">
          {NAV.map((group, gi) => (
            <div key={gi}>
              {group.group && (
                <div className="text-[9px] uppercase tracking-[0.14em] text-slate-400 px-2 pt-3 pb-1">{group.group}</div>
              )}
              {group.items.map((item) => {
                if (item.key === "comms-center") {
                  const base = typeof window !== "undefined" && window.location.pathname.startsWith("/metacrm") ? "/metacrm" : "";
                  return (
                    <button
                      key={item.key}
                      onClick={() => window.location.assign(`${base}/communications`)}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition text-[#f97316] hover:bg-orange-50 border border-orange-200/60 font-semibold"
                    >
                      {item.label}
                    </button>
                  );
                }
                const active = view === item.key || (item.key === "leads" && view === "leads-mine");
                return (
                  <button
                    key={item.key}
                    onClick={() => go(item.key as View)}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition ${
                      active
                        ? "bg-[#3d7ff7]/15 text-[#2563eb] border border-[#3d7ff7]/30 font-semibold"
                        : "text-slate-500 hover:text-slate-900 hover:bg-slate-50 border border-transparent"
                    }`}
                  >
                    {item.label}
                    {item.key === "inbox" && liveEvents > 0 && (
                      <span className="ml-1.5 text-[8px] bg-[#3d7ff7] text-white font-bold rounded-full px-1">{liveEvents}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="p-3 border-t border-slate-200">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
            <div className="text-xs text-slate-900 font-medium truncate">{refreshedUser.name}</div>
            <div className="text-[10px] text-slate-400">{refreshedUser.role.replace(/_/g, " ")}{refreshedUser.department ? ` · ${refreshedUser.department}` : ""}</div>
            <button onClick={doLogout} className="mt-2 text-[10px] text-rose-600 hover:underline">Sign out</button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 p-5 overflow-x-hidden">
        {view === "dashboard" && <DashboardView go={go} />}
        {view === "leads" && <LeadsView user={refreshedUser} employees={employees} />}
        {view === "leads-mine" && <LeadsView user={{ ...refreshedUser, role: refreshedUser.role }} employees={employees} />}
        {view === "import" && <ImportView onImported={() => void loadEmployees()} />}
        {view === "inbox" && (
          <InboxView user={refreshedUser} openConversationId={openConversationId} setOpenConversationId={setOpenConversationId} />
        )}
        {view === "dialer" && <DialerView user={refreshedUser} employees={employees} onChanged={() => void loadEmployees()} />}
        {view === "calls" && <CallsView user={refreshedUser} />}
        {view === "campaigns" && <CampaignsView user={refreshedUser} />}
        {view === "templates" && <TemplatesView user={refreshedUser} />}
        {view === "followups" && <FollowUpsView user={refreshedUser} onChanged={() => void loadEmployees()} />}
        {view === "employees" && <EmployeesView user={refreshedUser} />}
        {view === "analytics" && <AnalyticsView />}
        {view === "integrations" && <IntegrationsView user={refreshedUser} onSaved={() => void loadEmployees()} />}
        {view === "settings" && <SettingsView user={refreshedUser} />}
      </main>

      {/* Live toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-[60] rounded-xl border border-[#3d7ff7]/40 bg-[#ffffff]/95 backdrop-blur px-4 py-3 shadow-2xl max-w-sm">
          <div className="text-[10px] uppercase tracking-wider text-[#3d7ff7] mb-0.5">Live activity</div>
          <div className="text-xs text-slate-800">{toast}</div>
        </div>
      )}
    </div>
  );
}
