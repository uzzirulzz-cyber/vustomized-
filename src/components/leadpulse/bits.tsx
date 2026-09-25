"use client";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

// ── Palette (spec §21): dark navy / black / white / silver / gold ──
export const GOLD = "#3d7ff7";

export function KpiCard({
  label, value, sub, tone = "default",
}: {
  label: string; value: string | number; sub?: string; tone?: "default" | "gold" | "danger" | "success";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-slate-200 bg-white shadow-sm p-4 min-w-0",
        tone === "gold" && "border-[#3d7ff7]/30 bg-[#3d7ff7]/[0.06]",
        tone === "danger" && "border-rose-400/25 bg-rose-500/[0.06]",
        tone === "success" && "border-emerald-400/25 bg-emerald-500/[0.06]",
      )}
    >
      <div className="text-[10px] uppercase tracking-wider text-slate-500 truncate">{label}</div>
      <div className={cn(
        "mt-1 text-xl font-semibold tabular-nums truncate",
        tone === "gold" ? "text-[#2563eb]" : "text-slate-900",
        tone === "danger" && "text-rose-600",
        tone === "success" && "text-emerald-600",
      )}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      {sub && <div className="text-[10px] text-slate-400 mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  new: "bg-sky-500/15 text-sky-600 border-sky-400/40",
  contacted: "bg-amber-500/15 text-amber-600 border-amber-400/40",
  qualified: "bg-violet-500/15 text-violet-600 border-violet-400/40",
  converted: "bg-emerald-500/15 text-emerald-600 border-emerald-400/40",
  archived: "bg-slate-100 text-slate-500 border-slate-200",
  do_not_contact: "bg-rose-500/15 text-rose-600 border-rose-400/40",
  draft: "bg-slate-100 text-slate-600 border-slate-200",
  scheduled: "bg-sky-500/15 text-sky-600 border-sky-400/40",
  running: "bg-emerald-500/15 text-emerald-600 border-emerald-400/40",
  paused: "bg-amber-500/15 text-amber-600 border-amber-400/40",
  completed: "bg-emerald-600/15 text-emerald-600 border-emerald-500/30",
  cancelled: "bg-rose-500/15 text-rose-600 border-rose-400/40",
  queued: "bg-slate-100 text-slate-600 border-slate-200",
  sent: "bg-sky-500/15 text-sky-600 border-sky-400/40",
  delivered: "bg-teal-500/15 text-teal-600 border-teal-400/40",
  read: "bg-emerald-500/15 text-emerald-600 border-emerald-400/40",
  failed: "bg-rose-500/15 text-rose-600 border-rose-400/40",
  replied: "bg-violet-500/15 text-violet-600 border-violet-400/40",
  excluded_optout: "bg-rose-500/15 text-rose-600 border-rose-400/40",
  excluded_invalid: "bg-slate-100 text-slate-500 border-slate-200",
  meta_pending: "bg-amber-500/15 text-amber-600 border-amber-400/40",
  meta_approved: "bg-emerald-500/15 text-emerald-600 border-emerald-400/40",
  meta_rejected: "bg-rose-500/15 text-rose-600 border-rose-400/40",
  free_form: "bg-teal-500/15 text-teal-600 border-teal-400/40",
  urgent: "bg-rose-500/15 text-rose-600 border-rose-400/40",
  high: "bg-amber-500/15 text-amber-600 border-amber-400/40",
  normal: "bg-slate-100 text-slate-600 border-slate-200",
  low: "bg-slate-100 text-slate-500 border-slate-200",
  interested: "bg-emerald-500/15 text-emerald-600 border-emerald-400/40",
  callback_requested: "bg-amber-500/15 text-amber-600 border-amber-400/40",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 font-medium border whitespace-nowrap", STATUS_COLORS[status] || "bg-slate-100 text-slate-600 border-slate-200")}>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-900">{children}</h2>
      {right}
    </div>
  );
}

export function GoldButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg bg-[#3d7ff7] hover:bg-[#2563eb] text-white text-xs font-semibold px-3.5 h-9 shadow-sm shadow-[#3d7ff7]/30 transition disabled:opacity-50 disabled:pointer-events-none",
        props.className,
      )}
    >
      {children}
    </button>
  );
}

export function GhostButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-800 text-xs font-medium px-3 h-9 transition disabled:opacity-50 disabled:pointer-events-none",
        props.className,
      )}
    >
      {children}
    </button>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      <div className="w-10 h-10 rounded-full border border-slate-200 bg-slate-50 mb-3 flex items-center justify-center text-[#3d7ff7]">—</div>
      <div className="text-sm text-slate-600">{title}</div>
      {hint && <div className="text-xs text-slate-400 mt-1 max-w-sm">{hint}</div>}
    </div>
  );
}

export function timeAgo(date: string | Date): string {
  const d = new Date(date);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toISOString().slice(0, 10);
}
