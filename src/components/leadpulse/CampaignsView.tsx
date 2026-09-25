"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/lp/api";
import { SectionTitle, StatusPill, GoldButton, GhostButton, KpiCard, EmptyState } from "./bits";
import { leadName } from "./LeadsView";

type Stats = { recipients: number; queued: number; sent: number; delivered: number; read: number; failed: number; replies: number; optOuts: number };
type Campaign = { id: string; name: string; status: string; templateId: string | null; scheduleAt: string | null; dailyLimit: number; minIntervalSec: number; launchedAt: string | null; stats: Stats; template?: { id: string; name: string; approvalStatus: string } | null; sender?: { name: string } | null };
type Recipient = { id: string; status: string; error: string | null; renderedBody: string | null; sentAt: string | null; lead: { id: string; firstName: string | null; lastName: string | null; company: string | null; whatsapp: string | null; country: string | null } };
type Template = { id: string; name: string; approvalStatus: string; kind: string; language: string };
type LeadLite = { id: string; firstName: string | null; lastName: string | null; company: string | null; status: string; country: string | null; score: number; tags: string; whatsapp: string | null };

export default function CampaignsView({ user }: { user: { id: string; role: string } }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [leads, setLeads] = useState<LeadLite[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [recipients, setRecipients] = useState<Recipient[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState<{ campaign: Campaign; queued: number; excludedOptOut: number; excludedInvalid: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", templateId: "", dailyLimit: "200", minIntervalSec: "8", scheduleAt: "", audienceStatus: "all", audienceTag: "" });

  const canManage = ["super_admin", "admin", "manager"].includes(user.role);

  const load = useCallback(async () => {
    const [c, t] = await Promise.all([
      api<{ campaigns: Campaign[] }>("/api/lp/campaigns"),
      api<{ templates: Template[] }>("/api/lp/templates"),
    ]);
    setCampaigns(c.campaigns);
    setTemplates(t.templates);
  }, []);

  const loadLeads = useCallback(async () => {
    const data = await api<{ leads: LeadLite[] }>("/api/lp/leads?pageSize=50");
    setLeads(data.leads);
  }, []);

  const loadRecipients = useCallback(async (id: string) => {
    const data = await api<{ recipients: Recipient[] }>(`/api/lp/campaigns/${id}`);
    setRecipients(data.recipients);
  }, []);

  useEffect(() => { void load(); void loadLeads(); const t = setInterval(load, 8000); return () => clearInterval(t); }, [load, loadLeads]);
  useEffect(() => { if (selectedId) { void loadRecipients(selectedId); } }, [selectedId, loadRecipients]);

  // tick running campaigns
  useEffect(() => {
    const running = campaigns.find((c) => c.status === "running");
    if (!running || !canManage) return;
    const tick = async () => {
      try {
        await api(`/api/lp/campaigns/${running.id}/tick`, { method: "POST" });
        await load();
        if (selectedId === running.id) await loadRecipients(running.id);
      } catch { /* next tick */ }
    };
    void tick();
    const t = setInterval(tick, 6000);
    return () => clearInterval(t);
  }, [campaigns, canManage, load, selectedId, loadRecipients]);

  const create = async () => {
    setBusy(true); setError("");
    try {
      const audience: Record<string, unknown> = {};
      if (form.audienceStatus && form.audienceStatus !== "all") audience.status = form.audienceStatus;
      if (form.audienceTag) audience.tag = form.audienceTag;
      await api("/api/lp/campaigns", {
        method: "POST",
        body: JSON.stringify({
          name: form.name, templateId: form.templateId || null,
          dailyLimit: form.dailyLimit, minIntervalSec: form.minIntervalSec,
          scheduleAt: form.scheduleAt || null, audience,
        }),
      });
      setCreating(false);
      setForm({ name: "", templateId: "", dailyLimit: "200", minIntervalSec: "8", scheduleAt: "", audienceStatus: "all", audienceTag: "" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  };

  const action = async (campaign: Campaign, act: string) => {
    setBusy(true); setError("");
    try {
      if (act === "launch") {
        const res = await api<{ queued: number; excludedOptOut: number; excludedInvalid: number }>(`/api/lp/campaigns/${campaign.id}/action`, { method: "POST", body: JSON.stringify({ action: "launch" }) });
        setConfirming({ campaign, queued: res.queued, excludedOptOut: res.excludedOptOut, excludedInvalid: res.excludedInvalid });
      } else {
        await api(`/api/lp/campaigns/${campaign.id}/action`, { method: "POST", body: JSON.stringify({ action: act }) });
      }
      await load();
      if (selectedId) await loadRecipients(selectedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const confirmLaunch = async () => {
    if (!confirming) return;
    setBusy(true);
    try {
      // launch already queued recipients; nothing else needed — the campaign is running
      setConfirming(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const selected = campaigns.find((c) => c.id === selectedId) || null;

  return (
    <div className="space-y-4">
      <SectionTitle right={canManage ? <GoldButton onClick={() => setCreating((v) => !v)}>{creating ? "Close" : "Create Campaign"}</GoldButton> : undefined}>
        WhatsApp Campaigns
      </SectionTitle>

      {error && <div className="text-xs text-rose-600 bg-rose-500/10 border border-rose-400/20 rounded-lg px-3 py-2">{error}</div>}

      {creating && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div><label className="text-[10px] uppercase text-slate-400 block mb-1">Campaign name</label>
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="w-full h-9 rounded-lg bg-slate-50 border border-slate-200 px-3 text-xs text-slate-900" /></div>
            <div><label className="text-[10px] uppercase text-slate-400 block mb-1">Meta-approved template</label>
              <select value={form.templateId} onChange={(e) => setForm((f) => ({ ...f, templateId: e.target.value }))} className="w-full h-9 rounded-lg bg-slate-50 border border-slate-200 px-2 text-xs text-slate-800">
                <option value="">— select —</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.approvalStatus.replace("meta_", "")})</option>)}
              </select></div>
            <div><label className="text-[10px] uppercase text-slate-400 block mb-1">Schedule (optional)</label>
              <input type="datetime-local" value={form.scheduleAt} onChange={(e) => setForm((f) => ({ ...f, scheduleAt: e.target.value }))} className="w-full h-9 rounded-lg bg-slate-50 border border-slate-200 px-2 text-xs text-slate-900 [color-scheme:dark]" /></div>
            <div><label className="text-[10px] uppercase text-slate-400 block mb-1">Audience status</label>
              <select value={form.audienceStatus} onChange={(e) => setForm((f) => ({ ...f, audienceStatus: e.target.value }))} className="w-full h-9 rounded-lg bg-slate-50 border border-slate-200 px-2 text-xs text-slate-800">
                {["all", "new", "contacted", "qualified"].map((s) => <option key={s} value={s}>{s}</option>)}
              </select></div>
            <div><label className="text-[10px] uppercase text-slate-400 block mb-1">Daily send limit</label>
              <input value={form.dailyLimit} onChange={(e) => setForm((f) => ({ ...f, dailyLimit: e.target.value }))} inputMode="numeric" className="w-full h-9 rounded-lg bg-slate-50 border border-slate-200 px-3 text-xs text-slate-900" /></div>
            <div><label className="text-[10px] uppercase text-slate-400 block mb-1">Min interval (sec) between sends</label>
              <input value={form.minIntervalSec} onChange={(e) => setForm((f) => ({ ...f, minIntervalSec: e.target.value }))} inputMode="numeric" className="w-full h-9 rounded-lg bg-slate-50 border border-slate-200 px-3 text-xs text-slate-900" /></div>
          </div>
          <div className="flex justify-end"><GoldButton disabled={busy || !form.name} onClick={create}>Create {form.scheduleAt ? "(Scheduled)" : "(Draft)"}</GoldButton></div>
        </div>
      )}

      {/* Launch confirmation (spec §14) */}
      {confirming && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setConfirming(null)}>
          <div className="w-full max-w-md rounded-2xl bg-[#ffffff] border border-slate-200 p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-slate-900 mb-3">Confirm campaign launch</h3>
            <div className="space-y-1.5 text-xs text-slate-600 mb-4">
              <div>Campaign: <span className="text-slate-900">{confirming.campaign.name}</span></div>
              <div>Template: <span className="text-slate-900">{confirming.campaign.template?.name || "free-form"}</span></div>
              <div>Queue: <span className="text-[#2563eb] font-semibold">{confirming.queued} recipients</span></div>
              <div className="text-slate-500">Excluded: {confirming.excludedOptOut} opted-out · {confirming.excludedInvalid} no WhatsApp</div>
              <div className="text-slate-500">Daily limit: {confirming.campaign.dailyLimit}/day · throttle {confirming.campaign.minIntervalSec}s between sends</div>
              <div className="text-[10px] text-amber-600/90 pt-1">Sends respect WhatsApp anti-spam limits; the queue is processed gradually and can be paused anytime.</div>
            </div>
            <div className="flex gap-2 justify-end">
              <GhostButton onClick={() => setConfirming(null)}>Keep Paused</GhostButton>
              <GoldButton disabled={busy} onClick={confirmLaunch}>Confirm & Run</GoldButton>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Campaign list */}
        <div className="space-y-3">
          {campaigns.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50"><EmptyState title="No campaigns yet" hint="Create a campaign, pick a Meta-approved template and an audience." /></div>
          ) : (
            campaigns.map((c) => (
              <div key={c.id} onClick={() => { setSelectedId(c.id); setRecipients(null); }}
                role="button" tabIndex={0}
                className={`w-full text-left rounded-xl border p-4 transition cursor-pointer ${selectedId === c.id ? "border-[#3d7ff7]/40 bg-[#3d7ff7]/[0.05]" : "border-slate-200 bg-slate-50 hover:bg-slate-50"}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-slate-900">{c.name}</span>
                  <StatusPill status={c.status} />
                </div>
                <div className="text-[10px] text-slate-400 mb-2">
                  Template: {c.template?.name || "free-form"} · Sender: {c.sender?.name || "—"} · {c.scheduleAt ? `scheduled ${new Date(c.scheduleAt).toLocaleString()}` : "no schedule"}
                </div>
                <div className="grid grid-cols-8 gap-1.5 text-center">
                  {([["R", c.stats.recipients], ["Q", c.stats.queued], ["S", c.stats.sent], ["D", c.stats.delivered], ["Rd", c.stats.read], ["F", c.stats.failed], ["Rep", c.stats.replies], ["Opt", c.stats.optOuts]] as const).map(([label, v]) => (
                    <div key={label} className="rounded bg-white py-1">
                      <div className="text-[10px] font-semibold text-slate-800 tabular-nums">{v}</div>
                      <div className="text-[8px] text-slate-400 uppercase">{label}</div>
                    </div>
                  ))}
                </div>
                {canManage && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {(c.status === "draft" || c.status === "scheduled" || c.status === "paused") && (
                      <GhostButton disabled={busy} onClick={(e) => { e.stopPropagation(); action(c, "launch"); }} className="!h-7 !px-2 text-emerald-600 border-emerald-400/40">Launch</GhostButton>
                    )}
                    {c.status === "running" && <GhostButton disabled={busy} onClick={(e) => { e.stopPropagation(); action(c, "pause"); }} className="!h-7 !px-2">Pause</GhostButton>}
                    {(c.status === "running" || c.status === "paused") && <GhostButton disabled={busy} onClick={(e) => { e.stopPropagation(); action(c, "cancel"); }} className="!h-7 !px-2 text-rose-600 border-rose-400/40">Cancel</GhostButton>}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Recipients of selected */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-400">Recipients {selected ? `— ${selected.name}` : ""}</div>
          {!selected || !recipients ? (
            <EmptyState title="Select a campaign" hint="Queue state, provider status and errors appear here." />
          ) : recipients.length === 0 ? (
            <EmptyState title="No recipients queued" hint="Launch the campaign to build the audience queue." />
          ) : (
            <div className="overflow-y-auto max-h-[480px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-[#ffffff]">
                  <tr className="text-left text-[10px] uppercase text-slate-400 border-b border-slate-200">
                    <th className="px-3 py-2">Lead</th><th className="px-3 py-2">WhatsApp</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {recipients.map((r) => (
                    <tr key={r.id} className="border-b border-slate-100">
                      <td className="px-3 py-1.5 text-slate-800">{leadName(r.lead)}</td>
                      <td className="px-3 py-1.5 text-slate-500 tabular-nums">{r.lead.whatsapp || "—"}</td>
                      <td className="px-3 py-1.5"><StatusPill status={r.status} /></td>
                      <td className="px-3 py-1.5 text-[10px] text-slate-400 max-w-40 truncate">{r.error || (r.sentAt ? new Date(r.sentAt).toLocaleTimeString() : "—")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
