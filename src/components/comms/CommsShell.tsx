"use client";

// PlayBeat Pulse — Communications Console shell (spec §1).
// Dark enterprise layout: glass sidebar + top bar with REAL connection
// indicators (health endpoint), agent presence (heartbeat), notifications.
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { api, logout, tryRestore, type LpUser } from "@/lib/lp/api";
import { cn } from "@/lib/utils";
import { Avatar, StatusDot, StatusPill, timeAgo, type DotState } from "./shared";

export type CommsView =
  | "dashboard" | "whatsapp" | "phone" | "calls" | "contacts" | "leads"
  | "voicemail" | "templates" | "broadcasts" | "team" | "analytics" | "settings";

const NAV: { group: string; items: { key: CommsView; label: string; icon: string }[] }[] = [
  { group: "", items: [{ key: "dashboard", label: "Communications", icon: "◈" }] },
  {
    group: "Messaging & Calls",
    items: [
      { key: "whatsapp", label: "WhatsApp", icon: "✆" },
      { key: "phone", label: "Calls Dialer", icon: "▤" },
      { key: "calls", label: "Call History", icon: "≡" },
      { key: "voicemail", label: "Voicemail", icon: "◉" },
    ],
  },
  {
    group: "Audience",
    items: [
      { key: "contacts", label: "Contacts", icon: "☰" },
      { key: "leads", label: "Leads", icon: "◎" },
      { key: "broadcasts", label: "Broadcasts", icon: "➤" },
      { key: "templates", label: "Templates", icon: "▦" },
    ],
  },
  {
    group: "Operations",
    items: [
      { key: "team", label: "Team Inbox", icon: "øy" },
      { key: "analytics", label: "Analytics", icon: "◨" },
      { key: "settings", label: "Settings", icon: "⚙" },
    ],
  },
];

export type HealthState = {
  whatsapp: { status: string; detail?: string; latencyMs?: number };
  webhook: { status: string; lastEventAt: string | null; lastKind: string | null; failed24h: number; received24h: number };
  calling: { configured: boolean; provider: string | null; status: string };
  database: string;
  checkedAt: string;
} | null;

type PresenceMember = { id: string; name: string; role: string; status: string; derivedOnline: boolean; openConversations: number; unreadConversations: number };

const PRESENCE_OPTIONS = [
  { value: "available", label: "Available", color: "#25d366" },
  { value: "busy", label: "Busy", color: "#f97316" },
  { value: "on_call", label: "On Call", color: "#fbbf24" },
  { value: "away", label: "Away", color: "#94a3b8" },
  { value: "offline", label: "Offline", color: "#64748b" },
];

export default function CommsShell({
  user, view, setView, children, onTeamEvent,
}: {
  user: LpUser;
  view: CommsView;
  setView: (v: CommsView) => void;
  children: React.ReactNode;
  onTeamEvent?: () => void;
}) {
  const [health, setHealth] = useState<HealthState>(null);
  const [presence, setPresence] = useState<PresenceMember[]>([]);
  const [myStatus, setMyStatus] = useState<string>("available");
  const [presOpen, setPresOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [liveEvents, setLiveEvents] = useState(0);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const refreshHealth = useCallback(async () => {
    try {
      const h = await api<Exclude<HealthState, null>>("/api/lp/communications/health");
      setHealth(h);
      setLastSync(new Date());
    } catch { /* keep last state */ }
  }, []);

  const refreshPresence = useCallback(async () => {
    try {
      const d = await api<{ members: PresenceMember[] }>("/api/lp/communications/presence");
      setPresence(d.members);
      const me = d.members.find((m) => m.id === user.id);
      if (me) setMyStatus(me.status === "offline" && me.derivedOnline ? "available" : me.status);
    } catch { /* viewer may lack access */ }
  }, [user.id]);

  // health + presence polling
  useEffect(() => {
    void refreshHealth();
    void refreshPresence();
    const hi = setInterval(() => void refreshHealth(), 30000);
    const pi = setInterval(() => void refreshPresence(), 25000);
    return () => { clearInterval(hi); clearInterval(pi); };
  }, [refreshHealth, refreshPresence]);

  // presence heartbeat — keeps "online" real
  useEffect(() => {
    const beat = () => { api("/api/lp/communications/presence", { method: "POST", body: JSON.stringify({ heartbeat: true }) }).catch(() => {}); };
    beat();
    const t = setInterval(beat, 45000);
    return () => clearInterval(t);
  }, []);

  // realtime (socket where the host allows it — sandbox/localhost; Vercel polls)
  useEffect(() => {
    const h = typeof location !== "undefined" ? location.hostname : "";
    const realtimeCapable = h === "localhost" || h === "127.0.0.1" || h.endsWith(".space-z.ai");
    if (!realtimeCapable) return;
    const socket = io("/?XTransformPort=3003", { path: "/" });
    socketRef.current = socket;
    socket.on("message", () => {
      setLiveEvents((n) => n + 1);
      onTeamEvent?.();
      void refreshPresence();
    });
    return () => { socket.disconnect(); socketRef.current = null; };
  }, [refreshPresence, onTeamEvent]);

  const setPresenceStatus = async (status: string) => {
    setMyStatus(status);
    setPresOpen(false);
    try {
      await api("/api/lp/communications/presence", { method: "POST", body: JSON.stringify({ status }) });
      void refreshPresence();
    } catch { /* non-fatal */ }
  };

  const waState: DotState = !health
    ? "reconnecting"
    : health.whatsapp.status === "connected"
      ? "connected"
      : health.whatsapp.status === "not_configured" ? "not_configured" : "disconnected";
  const phoneState = !health ? "offline" : health.calling.configured ? "registered" : "not_configured";
  const notifCount = health ? (health.webhook.failed24h > 0 ? health.webhook.failed24h : 0) + (health.calling.configured ? 0 : 1) : 0;

  const myPresence = PRESENCE_OPTIONS.find((p) => p.value === myStatus) || PRESENCE_OPTIONS[4];

  return (
    <div className="comms-root min-h-screen flex">
      {/* ── Sidebar ── */}
      <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-[var(--cm-border)] bg-[rgba(8,12,22,0.6)] backdrop-blur-xl sticky top-0 h-screen">
        <div className="px-4 py-4 border-b border-[var(--cm-border)]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl comms-btn-primary flex items-center justify-center text-white text-sm font-black">P</div>
            <div>
              <div className="text-[13px] font-bold tracking-wide text-slate-100 leading-none">PLAYBEAT <span className="text-[#6ea3ff]">PULSE</span></div>
              <div className="text-[9px] text-slate-500 uppercase tracking-[0.16em] mt-1">Communications Console</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto comms-scroll py-2 px-2.5 space-y-0.5">
          {NAV.map((group, gi) => (
            <div key={gi}>
              {group.group && <div className="text-[9px] uppercase tracking-[0.16em] text-slate-500 px-2.5 pt-3.5 pb-1.5">{group.group}</div>}
              {group.items.map((item) => (
                <button
                  key={item.key}
                  onClick={() => setView(item.key)}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs border border-transparent transition text-left",
                    view === item.key ? "comms-nav-active font-semibold" : "text-slate-400 hover:text-slate-200 hover:bg-[rgba(148,163,184,0.07)]"
                  )}
                >
                  <span className={cn("text-[13px] w-4 text-center", view === item.key ? "text-[#8db1ff]" : "text-slate-500")}>{item.icon}</span>
                  {item.label}
                  {item.key === "whatsapp" && liveEvents > 0 && (
                    <span className="ml-auto text-[8px] bg-[#3d7ff7] text-white font-bold rounded-full px-1.5 py-0.5">{liveEvents}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* presence */}
        <div className="p-3 border-t border-[var(--cm-border)] relative">
          {presOpen && (
            <div className="absolute bottom-16 left-3 right-3 comms-panel p-1.5 z-30 shadow-2xl" style={{ background: "var(--cm-panel-solid)" }}>
              {PRESENCE_OPTIONS.map((p) => (
                <button key={p.value} onClick={() => void setPresenceStatus(p.value)}
                  className={cn("w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs transition", myStatus === p.value ? "bg-[rgba(61,127,247,0.15)] text-slate-100" : "text-slate-400 hover:bg-[rgba(148,163,184,0.08)]")}>
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
                  {p.label}
                </button>
              ))}
            </div>
          )}
          <button onClick={() => setPresOpen((v) => !v)} className="w-full flex items-center gap-2.5 rounded-xl border border-[var(--cm-border)] bg-[rgba(148,163,184,0.05)] p-2.5 hover:border-[var(--cm-border-strong)] transition text-left">
            <div className="relative">
              <Avatar name={user.name} size={32} />
              <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#0b1120]" style={{ backgroundColor: myPresence.color }} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-slate-200 truncate">{user.name}</div>
              <div className="text-[10px] text-slate-500">{myPresence.label} · {user.role.replace(/_/g, " ")}</div>
            </div>
            <span className="text-slate-500 text-[10px]">▲</span>
          </button>
          <div className="flex items-center justify-between mt-2 px-1">
            <a href="/metacrm" className="text-[10px] text-slate-500 hover:text-slate-300 transition">← CRM workspace</a>
            <button onClick={() => void logout().then(() => window.location.assign("/metacrm"))} className="text-[10px] text-rose-400/80 hover:text-rose-300 transition">Sign out</button>
          </div>
        </div>
      </aside>

      {/* ── Main column ── */}
      <div className="flex-1 min-w-0 flex flex-col h-screen">
        {/* top bar */}
        <header className="shrink-0 flex items-center gap-3 px-4 py-2.5 border-b border-[var(--cm-border)] bg-[rgba(8,12,22,0.5)] backdrop-blur-xl z-20">
          {/* mobile nav */}
          <select
            value={view}
            onChange={(e) => setView(e.target.value as CommsView)}
            className="md:hidden comms-input px-2 py-1.5 text-xs"
            aria-label="Console section"
          >
            {NAV.flatMap((g) => g.items).map((i) => <option key={i.key} value={i.key}>{i.label}</option>)}
          </select>

          <div className="hidden md:flex items-center gap-2">
            <StatusPill label="WhatsApp" state={waState} />
            <StatusPill label="Phone" state={phoneState as "registered" | "not_configured" | "offline"} />
            {health && health.webhook.failed24h > 0 && (
              <span className="comms-chip inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px]">
                <StatusDot state="degraded" />
                <span className="text-amber-300">{health.webhook.failed24h} webhook issue{health.webhook.failed24h !== 1 ? "s" : ""} (24h)</span>
              </span>
            )}
          </div>

          <div className="flex-1" />

          <div className="text-[10px] text-slate-500 hidden lg:block">
            DB {health?.database || "…"} · updated {lastSync ? timeAgo(lastSync.toISOString()) : "—"} ago
          </div>

          {/* notifications */}
          <div className="relative">
            <button onClick={() => setNotifOpen((v) => !v)} className="w-8 h-8 rounded-xl comms-chip flex items-center justify-center text-slate-300 hover:text-white transition" aria-label="Notifications">
              <span className="text-[13px]">◔</span>
              {notifCount > 0 && <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-[#f97316] text-white text-[9px] font-bold flex items-center justify-center">{notifCount}</span>}
            </button>
            {notifOpen && (
              <div className="absolute right-0 top-10 w-80 comms-panel p-3 z-40 shadow-2xl text-xs" style={{ background: "var(--cm-panel-solid)" }}>
                <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">System notifications</div>
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <StatusDot state={waState} />
                    <div><div className="text-slate-200">WhatsApp: {waState.replace(/_/g, " ")}</div>
                      <div className="text-[10px] text-slate-500">{health?.whatsapp.detail || (waState === "connected" ? "Graph API verified" : "check Settings → Communications")}</div></div>
                  </div>
                  <div className="flex items-start gap-2">
                    <StatusDot state={phoneState as "registered" | "not_configured"} />
                    <div><div className="text-slate-200">Calling: {phoneState.replace(/_/g, " ")}</div>
                      <div className="text-[10px] text-slate-500">{health?.calling.configured ? health.calling.provider : "no provider credentials saved"}</div></div>
                  </div>
                  <div className="flex items-start gap-2">
                    <StatusDot state={health ? (health.webhook.status as "healthy" | "degraded") : "reconnecting"} />
                    <div><div className="text-slate-200">Webhook {health?.webhook.status || "…"}</div>
                      <div className="text-[10px] text-slate-500">last {timeAgo(health?.webhook.lastEventAt)} · {health?.webhook.received24h ?? 0} events/24h · {health?.webhook.failed24h ?? 0} failed</div></div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* availability quick-select (desktop) */}
          <button onClick={() => setPresOpen((v) => !v)} className="hidden md:flex items-center gap-2 comms-chip px-2.5 py-1.5 text-[10px] text-slate-300 hover:border-[var(--cm-border-strong)] transition">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: myPresence.color }} />
            {myPresence.label}
          </button>

          <Avatar name={user.name} size={30} />
        </header>

        {/* view outlet */}
        <main className="flex-1 min-h-0 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
