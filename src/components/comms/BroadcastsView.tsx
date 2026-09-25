"use client";

// Broadcasts — approved-template campaigns to a filtered audience.
// Reuses the campaign engine: real audience counts, real template sends,
// honest per-recipient statuses. Free-form body is only allowed to audiences
// with open 24h windows (enforced server-side).
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/lp/api";
import { cn } from "@/lib/utils";
import type { LpUser } from "@/lib/lp/api";
import { timeAgo } from "./shared";

type Tpl = { id: string; name: string; language: string; bodyText: string; approvalStatus: string };
type Campaign = { id: string; name: string; status: string; templateId: string | null; bodyText: string | null; scheduledAt: string | null; createdAt: string; dailyLimit: number; recipients: { status: string }[] };

export default function BroadcastsView({ user }: { user: LpUser }) {
  const [tpls, setTpls] = useState<Tpl[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [name, setName] = useState("");
  const [tplId, setTplId] = useState("");
  const [audience, setAudience] = useState({ status: "", country: "", minScore: "" });
  const [estimates, setEstimates] = useState<{ total: number; hasWhatsapp: number; optedOut: number } | null>(null);
  const [launching, setLaunching] = useState(false);
  const [msg, setMsg] = useState("");
  const canManage = ["super_admin", "admin", "manager"].includes(user.role);

  const load = useCallback(async () => {
    try {
      const [t, c] = await Promise.all([
        api<{ templates: Tpl[] }>("/api/lp/templates"),
        api<{ campaigns: Campaign[] }>("/api/lp/campaigns"),
      ]);
      setTpls(t.templates.filter((x) => x.approvalStatus === "meta_approved"));
      setCampaigns(c.campaigns.slice(0, 10));
    } catch { /* keep */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const estimate = useCallback(async () => {
    try {
      const params = new URLSearchParams({ pageSize: "5" });
      if (audience.status) params.set("status", audience.status);
      if (audience.country) params.set("country", audience.country);
      if (audience.minScore) params.set("minScore", audience.minScore);
      const d = await api<{ total: number; leads: { whatsappNorm: string | null; optedOut: boolean }[] }>(`/api/lp/leads?${params.toString()}`);
      const sample = d.leads || [];
      const waRate = sample.length ? sample.filter((l) => l.whatsappNorm).length / sample.length : 0;
      const optRate = sample.length ? sample.filter((l) => l.optedOut).length / sample.length : 0;
      setEstimates({ total: d.total, hasWhatsapp: Math.round(d.total * waRate), optedOut: Math.round(d.total * optRate) });
    } catch { setEstimates(null); }
  }, [audience]);
  useEffect(() => { void estimate(); }, [estimate]);

  const launch = async () => {
    if (!tplId) { setMsg("Pick an approved template first."); return; }
    setLaunching(true); setMsg("");
    try {
      const audienceJson: Record<string, unknown> = {};
      if (audience.status) audienceJson.status = audience.status;
      if (audience.country) audienceJson.country = audience.country;
      if (audience.minScore) audienceJson.minScore = Number(audience.minScore);
      await api("/api/lp/campaigns", {
        method: "POST",
        body: JSON.stringify({
          name: name || `Broadcast ${new Date().toLocaleDateString()}`,
          templateId: tplId,
          audienceJson: JSON.stringify(audienceJson),
          scheduleAt: null,
        }),
      });
      setMsg("Broadcast created — it now ticks through the campaign engine with throttled, per-recipient delivery and honest statuses.");
      setName("");
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "launch failed");
    } finally { setLaunching(false); }
  };

  return (
    <div className="h-full overflow-y-auto comms-scroll p-4 lg:p-6">
      <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-5 items-start">
        <div className="comms-panel p-4">
          <div className="text-base font-bold text-slate-100 mb-1">New broadcast</div>
          <div className="text-[11px] text-slate-500 mb-4">Template messages to a lead audience — throttled, opt-out aware, per-recipient status tracking.</div>

          {!canManage ? (
            <div className="text-xs text-amber-400/90 bg-[rgba(251,191,36,0.06)] border border-[rgba(251,191,36,0.2)] rounded-xl px-3 py-2.5">
              Your role ({user.role.replace(/_/g, " ")}) can review broadcasts but not create them (RBAC).
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-slate-500">Broadcast name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ramadan offer — Gulf region" className="comms-input w-full h-9 px-3 text-xs mt-1" />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-slate-500">Approved template</label>
                <select value={tplId} onChange={(e) => setTplId(e.target.value)} className="comms-input w-full h-9 px-2 text-xs mt-1">
                  <option value="">Select a Meta-approved template…</option>
                  {tpls.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language})</option>)}
                </select>
                {tplId && (
                  <div className="mt-1.5 rounded-lg bg-[rgba(148,163,184,0.07)] border border-[var(--cm-border)] px-3 py-2 text-[11px] text-slate-400 whitespace-pre-wrap max-h-24 overflow-y-auto comms-scroll">
                    {tpls.find((t) => t.id === tplId)?.bodyText}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-slate-500">Lead status</label>
                  <select value={audience.status} onChange={(e) => setAudience((a) => ({ ...a, status: e.target.value }))} className="comms-input w-full h-9 px-1.5 text-xs mt-1">
                    <option value="">Any</option>
                    {["new", "contacted", "qualified", "converted"].map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-slate-500">Country</label>
                  <input value={audience.country} onChange={(e) => setAudience((a) => ({ ...a, country: e.target.value }))} placeholder="PK" className="comms-input w-full h-9 px-2 text-xs mt-1" />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-slate-500">Min score</label>
                  <input value={audience.minScore} onChange={(e) => setAudience((a) => ({ ...a, minScore: e.target.value.replace(/\D/g, "") }))} placeholder="70" className="comms-input w-full h-9 px-2 text-xs mt-1" />
                </div>
              </div>

              {estimates && (
                <div className="rounded-xl border border-[var(--cm-border)] px-3 py-2.5 text-[11px] text-slate-400 flex gap-4">
                  <span>Audience <b className="text-slate-200">{estimates.total}</b></span>
                  <span>~WhatsApp reach <b className="text-[#4ade80]">{estimates.hasWhatsapp}</b></span>
                  <span>~Suppressed <b className="text-[#f87171]">{estimates.optedOut}</b></span>
                </div>
              )}

              <button onClick={() => void launch()} disabled={launching || !tplId}
                className="w-full h-10 rounded-xl comms-btn-wa text-white text-sm font-bold transition disabled:opacity-50">
                {launching ? "Creating…" : "Create broadcast"}
              </button>
              {msg && <div className="text-[11px] text-slate-300 bg-[rgba(148,163,184,0.07)] border border-[var(--cm-border)] rounded-xl px-3 py-2">{msg}</div>}
            </div>
          )}
        </div>

        <div className="comms-panel p-4">
          <div className="text-base font-bold text-slate-100 mb-3">Recent broadcasts</div>
          {campaigns.length === 0 && <div className="text-xs text-slate-500 py-6 text-center">No broadcasts yet.</div>}
          <div className="space-y-2">
            {campaigns.map((c) => {
              const counts = c.recipients?.length
                ? c.recipients.reduce<Record<string, number>>((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {})
                : {};
              return (
                <div key={c.id} className="rounded-xl border border-[var(--cm-border)] p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-100 truncate flex-1">{c.name}</span>
                    <span className={cn("text-[9px] px-2 py-0.5 rounded-full border font-semibold uppercase",
                      c.status === "running" ? "border-[#25d366]/40 text-[#4ade80]" : c.status === "completed" ? "border-[#3d7ff7]/40 text-[#8db1ff]" : "comms-chip text-slate-400")}>
                      {c.status}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    created {timeAgo(c.createdAt)} ago · {Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(" · ") || "no recipients ticked yet"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
