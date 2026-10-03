"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/lp/api";
import { SectionTitle, StatusPill, EmptyState, timeAgo } from "./bits";

type CallRow = {
  id: string; direction: string; method: string; provider: string | null; status: string;
  outcome: string | null; durationSec: number | null; recordingUrl: string | null;
  notes: string | null; createdAt: string;
  lead: { id: string; firstName: string | null; lastName: string | null; company: string | null; phone: string | null; country: string | null };
  employee?: { id: string; name: string } | null;
};

export default function CallsView({ user }: { user: { id: string; role: string } }) {
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ calls: CallRow[] }>(`/api/lp/calls${scope === "mine" ? "?mine=1" : ""}`);
      setCalls(data.calls);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      <SectionTitle right={
        <div className="flex gap-1">
          {(["all", "mine"] as const).map((s) => (
            <button key={s} onClick={() => setScope(s)}
              className={`text-[10px] px-2.5 py-1 rounded-md border transition ${scope === s ? "border-[#3d7ff7]/50 bg-[#3d7ff7]/10 text-[#2563eb]" : "border-slate-200 text-slate-500"}`}>
              {s === "all" ? "All Calls" : "My Calls"}
            </button>
          ))}
        </div>
      }>
        Call Management
      </SectionTitle>

      <div className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wider text-slate-400">
                <th className="px-3 py-2.5">Lead</th><th className="px-3 py-2.5">Employee</th><th className="px-3 py-2.5">Date</th>
                <th className="px-3 py-2.5">Direction</th><th className="px-3 py-2.5">Placed via</th><th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Duration</th><th className="px-3 py-2.5">Outcome</th><th className="px-3 py-2.5">Recording</th><th className="px-3 py-2.5">Notes</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="px-3 py-10 text-center text-slate-400">Loading…</td></tr>
              ) : calls.length === 0 ? (
                <tr><td colSpan={10}><EmptyState title="No call records" hint="Log calls from the Dialer or a lead profile — records are honest activity entries." /></td></tr>
              ) : (
                calls.map((c) => (
                  <tr key={c.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-900">{[c.lead.firstName, c.lead.lastName].filter(Boolean).join(" ") || c.lead.company}</td>
                    <td className="px-3 py-2 text-slate-600">{c.employee?.name || "—"}</td>
                    <td className="px-3 py-2 text-slate-500">{new Date(c.createdAt).toLocaleString()}</td>
                    <td className="px-3 py-2 text-slate-600 capitalize">{c.direction}</td>
                    <td className="px-3 py-2 text-slate-600">{c.method === "device_dialer" ? "device dialer" : c.method === "whatsapp_open" ? "WhatsApp (manual)" : c.provider || c.method}</td>
                    <td className="px-3 py-2"><StatusPill status={c.status === "completed" ? "converted" : c.status === "no_answer" ? "normal" : c.status} /></td>
                    <td className="px-3 py-2 text-slate-600 tabular-nums">
                      {c.durationSec != null ? `${Math.floor(c.durationSec / 60)}m ${c.durationSec % 60}s` : <span className="text-slate-400">unknown</span>}
                    </td>
                    <td className="px-3 py-2">{c.outcome ? <StatusPill status={c.outcome} /> : <span className="text-slate-400">—</span>}</td>
                    <td className="px-3 py-2 text-slate-400">{c.recordingUrl || "not available"}</td>
                    <td className="px-3 py-2 text-slate-500 max-w-48 truncate">{c.notes || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[10px] text-slate-400">
        No telephony provider is connected, so &quot;Placed via&quot; records the real method (device dialer / WhatsApp).
        Recording URL stays empty unless a real provider supplies one — never fabricated (spec §9).
      </p>
    </div>
  );
}
