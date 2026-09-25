"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/lp/api";
import { SectionTitle, GoldButton, GhostButton } from "./bits";

type MaskedWa = {
  phoneNumberId: string; wabaId: string; graphVersion: string;
  webhookVerifyToken: string; hasAccessToken: boolean; accessTokenMask: string; connected: boolean;
};

export default function IntegrationsView({ user, onSaved }: { user: { id: string; role: string }; onSaved?: () => void }) {
  const [cfg, setCfg] = useState<MaskedWa | null>(null);
  const [form, setForm] = useState({ phoneNumberId: "", wabaId: "", accessToken: "", graphVersion: "v21.0", webhookVerifyToken: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const canManage = user.role === "super_admin";

  const load = useCallback(async () => {
    const data = await api<{ whatsapp: MaskedWa }>("/api/lp/integrations/whatsapp");
    setCfg(data.whatsapp);
    setForm((f) => ({ ...f, graphVersion: data.whatsapp.graphVersion || "v21.0" }));
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const patch: Record<string, string> = {};
      for (const [k, v] of Object.entries(form)) if (v.trim()) patch[k] = v.trim();
      await api("/api/lp/integrations/whatsapp", { method: "POST", body: JSON.stringify(patch) });
      await load();
      setMsg({ ok: true, text: "Credentials saved (stored server-side only — never exposed to the frontend)." });
      onSaved?.();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Save failed" });
    } finally { setBusy(false); }
  };

  const verify = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/lp/integrations/whatsapp", { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("lp_token") || ""}` } });
      // use api helper instead:
      const data = await api<{ ok: boolean; displayPhoneNumber?: string; verifiedName?: string; error?: string }>("/api/lp/integrations/whatsapp", { method: "PUT" });
      if (data.ok) {
        setMsg({ ok: true, text: `Meta verified the credentials: ${data.verifiedName || "WhatsApp account"} (${data.displayPhoneNumber || "number on file"}) — REAL Graph API response.` });
      } else {
        setMsg({ ok: false, text: `Meta rejected the credentials: ${data.error}` });
      }
      void res;
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Verify failed" });
    } finally { setBusy(false); }
  };

  const webhookUrl = typeof window !== "undefined" ? `${window.location.origin}/api/lp/webhooks/whatsapp` : "/api/lp/webhooks/whatsapp";

  return (
    <div className="space-y-4 max-w-2xl">
      <SectionTitle>Integrations — WhatsApp Business Platform (Meta Cloud API)</SectionTitle>

      {cfg && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs space-y-1.5">
          <div className="flex justify-between"><span className="text-slate-400">Status</span>
            <span className={cfg.connected ? "text-emerald-600" : "text-rose-600"}>{cfg.connected ? "CONNECTED" : "NOT CONNECTED"}</span></div>
          <div className="flex justify-between"><span className="text-slate-400">Phone Number ID</span><span className="text-slate-800 tabular-nums">{cfg.phoneNumberId || "—"}</span></div>
          <div className="flex justify-between"><span className="text-slate-400">WABA ID</span><span className="text-slate-800 tabular-nums">{cfg.wabaId || "—"}</span></div>
          <div className="flex justify-between"><span className="text-slate-400">Graph version</span><span className="text-slate-800">{cfg.graphVersion}</span></div>
          <div className="flex justify-between"><span className="text-slate-400">Access token</span><span className="text-slate-800">{cfg.accessTokenMask || "not set"}</span></div>
          <div className="flex justify-between"><span className="text-slate-400">Webhook verify token</span><span className="text-slate-800">{cfg.webhookVerifyToken || "—"}</span></div>
        </div>
      )}

      {canManage ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-400">Credentials — stored on the backend only (spec §16)</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input value={form.phoneNumberId} onChange={(e) => setForm((f) => ({ ...f, phoneNumberId: e.target.value }))} placeholder="Phone Number ID" className="h-9 rounded-lg bg-slate-50 border border-slate-200 px-3 text-xs text-slate-900" />
            <input value={form.wabaId} onChange={(e) => setForm((f) => ({ ...f, wabaId: e.target.value }))} placeholder="WhatsApp Business Account ID" className="h-9 rounded-lg bg-slate-50 border border-slate-200 px-3 text-xs text-slate-900" />
            <input value={form.accessToken} onChange={(e) => setForm((f) => ({ ...f, accessToken: e.target.value }))} placeholder="Permanent access token" type="password" className="h-9 rounded-lg bg-slate-50 border border-slate-200 px-3 text-xs text-slate-900" />
            <input value={form.webhookVerifyToken} onChange={(e) => setForm((f) => ({ ...f, webhookVerifyToken: e.target.value }))} placeholder="Webhook verify token" className="h-9 rounded-lg bg-slate-50 border border-slate-200 px-3 text-xs text-slate-900" />
            <select value={form.graphVersion} onChange={(e) => setForm((f) => ({ ...f, graphVersion: e.target.value }))} className="h-9 rounded-lg bg-slate-50 border border-slate-200 px-2 text-xs text-slate-800">
              {["v25.0", "v22.0", "v21.0", "v20.0", "v19.0"].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <GoldButton disabled={busy} onClick={save}>Save Credentials</GoldButton>
            <GhostButton disabled={busy} onClick={verify}>{busy ? "Testing…" : "Test against Meta (real)"}</GhostButton>
          </div>
          {msg && (
            <div className={`text-[11px] rounded-lg px-3 py-2 border ${msg.ok ? "text-emerald-600 bg-emerald-500/10 border-emerald-400/20" : "text-rose-600 bg-rose-500/10 border-rose-400/20"}`}>
              {msg.text}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
          Only the super admin can manage integration credentials.
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
        <div className="text-[10px] uppercase tracking-wider text-slate-400">Webhook (spec §17)</div>
        <div className="text-xs text-slate-600">Callback URL:</div>
        <code className="block text-[11px] text-[#2563eb] bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 break-all">{webhookUrl}</code>
        <div className="text-[10px] text-slate-400 leading-relaxed">
          Point your Meta App → WhatsApp → Configuration → Webhook at this URL with the verify token above.
          Handled events: messages (inbound), statuses (sent / delivered / read / failed) — the CRM updates automatically,
          inbound replies open conversations, mark campaign replies, and STOP keywords feed the suppression list.
        </div>
      </div>
    </div>
  );
}
