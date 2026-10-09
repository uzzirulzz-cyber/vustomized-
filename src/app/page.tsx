"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { BarChart3, Clock3, FileText, LayoutDashboard, Megaphone, MessageSquare, MessagesSquare, Plug, Phone, PhoneCall, PlayCircle, ShieldCheck, Upload, LogOut, UserCog, Users, UserRound, type LucideIcon } from "lucide-react";
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

const NAV_ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard, leads: Users, import: Upload, "leads-mine": UserRound,
  inbox: MessageSquare, dialer: Phone, calls: PhoneCall, "comms-center": MessagesSquare,
  campaigns: Megaphone, templates: FileText, followups: Clock3, employees: UserCog,
  analytics: BarChart3, integrations: Plug, settings: ShieldCheck,
};

const VIEW_LABELS: Partial<Record<View, string>> = {
  dashboard: "Dashboard", leads: "All Leads", "leads-mine": "My Leads", import: "Import CSV",
  inbox: "Messages", dialer: "Dialer", calls: "Calls", campaigns: "Campaigns",
  templates: "Templates", followups: "Follow-ups", employees: "Employees",
  analytics: "Analytics", integrations: "Integrations", settings: "Compliance & Audit",
};

export default function Page() {
  const [booted, setBooted] = useState(false);
  const [user, setUser] = useState<LpUser | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([]);
  const [openConversationId, setOpenConversationId] = useState<string | null>(null);
  const [liveEvents, setLiveEvents] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [openingChat, setOpeningChat] = useState(false);
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

  const openLeadWhatsApp = useCallback(async (leadId: string) => {
    setOpeningChat(true);
    try {
      const data = await api<{ conversation: { id: string } }>("/api/lp/conversations/find-or-create", {
        method: "POST", body: JSON.stringify({ leadId }),
      });
      setOpenConversationId(data.conversation.id);
      go("inbox");
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Could not open WhatsApp chat");
      setTimeout(() => setToast(null), 5000);
    } finally {
      setOpeningChat(false);
    }
  }, [go]);

  const openConversation = useCallback((conversationId: string) => {
    setOpenConversationId(conversationId);
    go("inbox");
  }, [go]);

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
      <aside className="w-16 lg:w-64 shrink-0 border-r border-slate-200 bg-white/95 backdrop-blur-xl flex flex-col sticky top-0 h-screen z-20 shadow-sm">
        <div className="h-16 px-2 lg:px-5 border-b border-slate-200 flex items-center gap-3 shrink-0">
          <span className="h-9 w-9 rounded-lg bg-[#3d7ff7] text-white flex items-center justify-center shadow-md shadow-blue-500/25 shrink-0"><PlayCircle className="h-5 w-5" /></span>
          <div className="hidden lg:block min-w-0">
            <div className="text-sm font-extrabold leading-none text-slate-900">Play<span className="text-[#3d7ff7]">Beat</span></div>
            <div className="text-[9px] text-slate-400 uppercase tracking-wider mt-1">Lead Pulse CRM</div>
          </div>
        </div>

        <nav aria-label="CRM navigation" className="flex-1 overflow-y-auto py-2 px-1.5 lg:px-3 space-y-1 [font-family:var(--font-raleway)]">
          {NAV.map((group, gi) => (
            <div key={gi}>
              {group.group && (
                <div className="hidden lg:block text-[9px] uppercase tracking-[0.14em] text-slate-400 px-2 pt-3 pb-1">{group.group}</div>
              )}
              {group.items.map((item) => {
                if (item.key === "comms-center") {
                  const base = typeof window !== "undefined" && window.location.pathname.startsWith("/metacrm") ? "/metacrm" : "";
                  return (
                    <button
                      key={item.key}
                      aria-label={item.label}
                      onClick={() => window.location.assign(`${base}/communications`)}
                      title={item.label}
                      className="w-full flex items-center justify-center lg:justify-start gap-2.5 px-0 lg:px-2.5 py-2 rounded-lg text-xs transition-all duration-200 text-[#c2410c] hover:bg-orange-50 border border-orange-200/60 font-semibold hover:shadow-sm active:translate-y-px"
                    >
                      <MessagesSquare className="h-[18px] w-[18px] shrink-0" />
                      <span className="hidden lg:inline">{item.label}</span>
                    </button>
                  );
                }
                const active = view === item.key || (item.key === "leads" && view === "leads-mine");
                const Icon = NAV_ICONS[item.key] || LayoutDashboard;
                return (
                  <button
                    key={item.key}
                    aria-label={item.label}
                    onClick={() => go(item.key as View)}
                    title={item.label}
                    aria-current={active ? "page" : undefined}
                    className={`w-full flex items-center justify-center lg:justify-start gap-2.5 px-0 lg:px-2.5 py-2 rounded-lg text-xs transition-all duration-200 hover:shadow-sm active:translate-y-px ${
                      active
                        ? "bg-sky-500/10 text-[#2563eb] border border-sky-500/30 font-semibold shadow-sm"
                        : "text-slate-500 hover:text-slate-900 hover:bg-slate-50 border border-transparent"
                    }`}
                  >
                    <Icon className="h-[18px] w-[18px] shrink-0" />
                    <span className="hidden lg:inline flex-1 text-left">{item.label}</span>
                    {item.key === "inbox" && liveEvents > 0 && (
                      <span className="ml-1 text-[8px] bg-[#3d7ff7] text-white font-bold rounded-full px-1">{liveEvents}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="p-2 lg:p-3 border-t border-slate-200 shrink-0">
          <div className="hidden lg:block rounded-lg border border-slate-200 bg-slate-50 p-2.5">
            <div className="text-xs text-slate-900 font-medium truncate">{refreshedUser.name}</div>
            <div className="text-[10px] text-slate-400">{refreshedUser.role.replace(/_/g, " ")}{refreshedUser.department ? ` · ${refreshedUser.department}` : ""}</div>
            <button onClick={doLogout} className="mt-2 text-[10px] text-rose-600 hover:underline transition-colors">Sign out</button>
          </div>
          <button onClick={doLogout} aria-label="Sign out" title="Sign out" className="lg:hidden w-full h-10 flex items-center justify-center rounded-lg text-rose-600 hover:bg-rose-50 transition-colors"><LogOut className="h-4 w-4" /></button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 overflow-x-hidden flex flex-col">
        <header className="h-16 px-4 md:px-6 sticky top-0 z-10 border-b border-slate-200 bg-white/85 backdrop-blur-xl flex items-center gap-3 shadow-sm">
          <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500"><span>PlayBeat</span><span className="text-slate-300">/</span><span className="font-semibold text-slate-900">{VIEW_LABELS[view] || "Lead Pulse"}</span></div>
          <div className="sm:hidden text-xs font-semibold text-slate-900">{VIEW_LABELS[view] || "Lead Pulse"}</div>
          <div className="ml-auto flex items-center gap-2 text-right">
            <span className="h-8 w-8 rounded-full bg-[#3d7ff7] text-white flex items-center justify-center text-[10px] font-bold">{refreshedUser.name.split(" ").map((word) => word[0]).slice(0, 2).join("")}</span>
            <span className="hidden md:block"><span className="block text-xs font-semibold text-slate-900">{refreshedUser.name}</span><span className="block text-[10px] text-slate-400">{refreshedUser.role.replace(/_/g, " ")}</span></span>
          </div>
        </header>
        <div key={view} className="flex-1 min-w-0 p-4 md:p-6 overflow-x-hidden lp-page-enter">
        {view === "dashboard" && <DashboardView go={go} />}
        {view === "leads" && <LeadsView user={refreshedUser} employees={employees} onOpenWhatsApp={openLeadWhatsApp} onOpenConversation={openConversation} openingChat={openingChat} />}
        {view === "leads-mine" && <LeadsView user={{ ...refreshedUser, role: refreshedUser.role }} employees={employees} onOpenWhatsApp={openLeadWhatsApp} onOpenConversation={openConversation} openingChat={openingChat} />}
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
        </div>
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
