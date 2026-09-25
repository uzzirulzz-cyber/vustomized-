"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/lp/api";
import { SectionTitle, StatusPill, GoldButton, GhostButton, EmptyState, timeAgo } from "./bits";

type OptOut = { id: string; channel: string; value: string; reason: string | null; source: string | null; optedOutAt: string; optBackInAt: string | null; lead?: { id: string; firstName: string | null; lastName: string | null; company: string | null } | null };
type AuditRow = { id: string; actorName: string | null; action: string; entity: string | null; entityId: string | null; detail: string | null; createdAt: string };
type HookRow = { id: string; kind: string; processed: boolean; createdAt: string; payloadJson: string };

export default function SettingsView({ user }: { user: { id: string; role: string } }) {
  const [tab, setTab] = useState<"compliance" | "audit">("compliance");
  const [optouts, setOptouts] = useState<OptOut[]>([]);
  const [logs, setLogs] = useState<AuditRow[]>([]);
  const [hooks, setHooks] = useState<HookRow[]>([]);
  const [addValue, setAddValue] = useState("");
  const [busy, setBusy] = useState(false);
  const canManage = ["super_admin", "admin"].includes(user.role);

  const load = useCallback(async () => {
    if (tab === "compliance" && canManage) {
      const d = await api<{ optouts: OptOut[] }>("/api/lp/optouts");
      setOptouts(d.optouts);
    }
    if (tab === "audit" && canManage) {
      const d = await api<{ logs: AuditRow[]; webhookEvents: HookRow[] }>("/api/lp/audit");
      setLogs(d.logs);
      setHooks(d.webhookEvents);
    }
  }, [tab, canManage]);

  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    if (!addValue.trim()) return;
    setBusy(true);
    try {
      await api("/api/lp/optouts", { method: "POST", body: JSON.stringify({ channel: "whatsapp", value: addValue, reason: "manual" }) });
      setAddValue("");
      await load();
    } finally { setBusy(false); }
  };

  const optIn = async (id: string) => {
    setBusy(true);
    try {
      await api("/api/lp/optouts", { method: "DELETE", body: JSON.stringify({ id }) });
      await load();
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <SectionTitle right={
        <div className="flex gap-1">
          {(["compliance", "audit"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`text-[10px] px-2.5 py-1 rounded-md border transition capitalize ${tab === t ? "border-[#3d7ff7]/50 bg-[#3d7ff7]/10 text-[#2563eb]" : "border-slate-200 text-slate-500"}`}>
              {t === "compliance" ? "Compliance & Suppression" : "Audit Logs"}
            </button>
          ))}
        </div>
      }>
        Settings
      </SectionTitle>

      {!canManage ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">Admin access required.</div>
      ) : tab === "compliance" ? (
        <>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-2">Add number to suppression list (Do-Not-Contact)</div>
            <div className="flex gap-2">
              <input value={addValue} onChange={(e) => setAddValue(e.target.value)} placeholder="+92300…" className="flex-1 h-9 rounded-lg bg-slate-50 border border-slate-200 px-3 text-xs text-slate-900" />
              <GoldButton disabled={busy || !addValue.trim()} onClick={add}>Suppress</GoldButton>
            </div>
            <div className="text-[10px] text-slate-400 mt-2">
              Opted-out contacts are excluded from campaigns at queue-time AND re-checked at send-time. STOP / UNSUBSCRIBE keywords are handled automatically by the webhook. Opt-back-in is explicit only (§15).
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-wider text-slate-400">
                  <th className="px-3 py-2.5">Channel</th><th className="px-3 py-2.5">Value</th><th className="px-3 py-2.5">Lead</th>
                  <th className="px-3 py-2.5">Reason</th><th className="px-3 py-2.5">Since</th><th className="px-3 py-2.5">State</th><th className="px-3 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {optouts.length === 0 ? (
                  <tr><td colSpan={7}><EmptyState title="Suppression list empty" /></td></tr>
                ) : (
                  optouts.map((o) => (
                    <tr key={o.id} className="border-b border-slate-100">
                      <td className="px-3 py-2 text-slate-600 capitalize">{o.channel}</td>
                      <td className="px-3 py-2 text-slate-800 tabular-nums">{o.value}</td>
                      <td className="px-3 py-2 text-slate-500">{o.lead ? [o.lead.firstName, o.lead.lastName].filter(Boolean).join(" ") || o.lead.company : "—"}</td>
                      <td className="px-3 py-2 text-slate-500">{o.reason || "—"}</td>
                      <td className="px-3 py-2 text-slate-400">{timeAgo(o.optedOutAt)}</td>
                      <td className="px-3 py-2">{o.optBackInAt ? <StatusPill status="free_form" /> : <StatusPill status="do_not_contact" />}</td>
                      <td className="px-3 py-2 text-right">
                        {!o.optBackInAt && <GhostButton disabled={busy} onClick={() => optIn(o.id)} className="!h-7 !px-2">Opt back in</GhostButton>}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <div className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-400">Audit log (latest 300)</div>
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-xs">
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id} className="border-b border-slate-100">
                      <td className="px-3 py-1.5 text-slate-400 w-40">{new Date(l.createdAt).toLocaleString()}</td>
                      <td className="px-3 py-1.5 text-slate-900 w-28">{l.actorName || "system"}</td>
                      <td className="px-3 py-1.5 text-[#2563eb] w-40">{l.action}</td>
                      <td className="px-3 py-1.5 text-slate-500">{l.detail || `${l.entity || ""} ${l.entityId || ""}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-400">Recent webhook deliveries (latest 30)</div>
            <div className="max-h-72 overflow-y-auto">
              {hooks.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-slate-400">No webhook payloads received yet.</div>
              ) : (
                hooks.map((h) => (
                  <div key={h.id} className="px-3 py-2 border-b border-slate-100 text-[10px] text-slate-400">
                    {new Date(h.createdAt).toLocaleString()} · {h.payloadJson.slice(0, 140)}…
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
