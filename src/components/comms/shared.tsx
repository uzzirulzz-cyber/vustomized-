"use client";

// Shared primitives for the PlayBeat Pulse Communications Console.
import { cn } from "@/lib/utils";

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "#";
  return ((parts[0][0] || "") + (parts[1]?.[0] || "")).toUpperCase();
}

const AVATAR_GRADIENTS = [
  "from-[#3d7ff7] to-[#2563eb]",
  "from-[#25d366] to-[#00a884]",
  "from-[#f97316] to-[#ea580c]",
  "from-[#fbbf24] to-[#f59e0b]",
  "from-[#8b5cf6] to-[#7c3aed]",
  "from-[#14b8a6] to-[#0d9488]",
];
export function Avatar({ name, size = 40, className }: { name: string; size?: number; className?: string }) {
  const idx = Math.abs([...name].reduce((a, c) => a + c.charCodeAt(0), 0)) % AVATAR_GRADIENTS.length;
  return (
    <div
      className={cn("rounded-full bg-gradient-to-br text-white font-bold flex items-center justify-center shrink-0 select-none", AVATAR_GRADIENTS[idx], className)}
      style={{ width: size, height: size, fontSize: size * 0.34 }}
      aria-hidden
    >
      {initialsOf(name)}
    </div>
  );
}

export type DotState = "connected" | "reconnecting" | "disconnected" | "not_configured" | "registered" | "calling" | "busy" | "offline" | "failed" | "healthy" | "degraded";
const DOT_COLOR: Record<string, string> = {
  connected: "#25d366", registered: "#25d366", healthy: "#25d366",
  reconnecting: "#fbbf24", calling: "#fbbf24", busy: "#fbbf24", degraded: "#fbbf24",
  disconnected: "#f87171", failed: "#f87171", offline: "#64748b", not_configured: "#64748b",
};
export function StatusDot({ state, pulse = true, size = 8 }: { state: DotState; pulse?: boolean; size?: number }) {
  const color = DOT_COLOR[state] || "#64748b";
  return (
    <span className={cn("comms-dot", pulse && (state === "connected" || state === "registered" || state === "reconnecting") && "animate-none")} style={{ width: size, height: size, backgroundColor: color, color, boxShadow: `0 0 8px ${color}66` }} />
  );
}

export function StatusPill({ label, state }: { label: string; state: DotState }) {
  const color = DOT_COLOR[state] || "#64748b";
  return (
    <span className="comms-chip inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-medium text-[--cm-text-dim]">
      <StatusDot state={state} />
      <span className="text-slate-300">{label}</span>
      <span style={{ color }}>{state.replace(/_/g, " ")}</span>
    </span>
  );
}

export function KpiCard({ label, value, sub, accent = "#3d7ff7", icon }: { label: string; value: string | number; sub?: string; accent?: string; icon?: React.ReactNode }) {
  return (
    <div className="comms-panel p-4 flex items-start gap-3 hover:border-[rgba(148,163,184,0.3)] transition-colors">
      <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${accent}1f`, color: accent }}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400">{label}</div>
        <div className="text-2xl font-bold text-slate-100 leading-tight mt-0.5">{value}</div>
        {sub && <div className="text-[10px] text-slate-500 mt-0.5 truncate">{sub}</div>}
      </div>
    </div>
  );
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function fmtDuration(sec: number | null | undefined): string {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function NotConfiguredPanel({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="comms-panel p-6 text-center max-w-md mx-auto">
      <div className="w-12 h-12 rounded-2xl mx-auto flex items-center justify-center bg-slate-500/10 text-slate-400 text-xl">◌</div>
      <div className="mt-3 text-sm font-semibold text-slate-200">{title}</div>
      <div className="mt-1 text-[11px] uppercase tracking-[0.14em] font-semibold text-amber-400/90">NOT CONFIGURED</div>
      {children && <div className="mt-2 text-xs text-slate-400 leading-relaxed">{children}</div>}
    </div>
  );
}
