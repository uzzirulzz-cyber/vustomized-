export const CURRENCY = "USD";

export function money(n: number | null | undefined): string {
  const v = n ?? 0;
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function shortMoney(n: number): string {
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function fmtTime(d: string | Date | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function fmtDateTime(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return `${fmtDate(d)} · ${fmtTime(d)}`;
}

export function timeAgo(d: string | Date | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(date);
}

export const ORDER_STATUSES = ["PENDING", "PROCESSING", "COMPLETED", "ON_HOLD", "CANCELLED", "REFUNDED", "DISPUTED"] as const;

export const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  PROCESSING: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  COMPLETED: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  ON_HOLD: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  CANCELLED: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  REFUNDED: "bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30",
  DISPUTED: "bg-red-500/15 text-red-400 border-red-500/30",
  ACTIVE: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  SUSPENDED: "bg-red-500/15 text-red-400 border-red-500/30",
  OPEN: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  CLOSED: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  PAID: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  FAILED: "bg-red-500/15 text-red-400 border-red-500/30",
  REQUESTED: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  APPROVED: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  REJECTED: "bg-red-500/15 text-red-400 border-red-500/30",
  PROCESSED: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  PARTIALLY_REFUNDED: "bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30",
};

export function titleCase(s: string): string {
  return s.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
