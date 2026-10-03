"use client";

// Communications settings (spec §22) + live system health (spec §23).
// Sensitive values are masked by the API — the browser never receives tokens.
// TEST CONNECTION performs a REAL provider check; failures show the reason.
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/lp/api";
import { cn } from "@/lib/utils";
import type { LpUser } from "@/lib/lp/api";
import { StatusDot, timeAgo } from "./shared";

type WaMasked = { phoneNumberId: string; wabaId: string; graphVersion: string; webhookVerifyToken: string; hasAccessToken: boolean; accessTokenMask: string; connected: boolean };
type CallingMasked = { configured: boolean; provider: string | null; adapterId: string; adapterLabel: string; fields: Record<string, string>; capabilities?: Record<string, boolean> };
type ProviderField = { key: string; label: string; placeholder: string; sensitive?: boolean };
type Health = {
  whatsapp: { status: string; detail?: string; latencyMs?: number };
  webhook: { status: string; lastEventAt: string | null; lastKind: string | null; failed24h: number; received24h: number };
  calling: { configured: boolean; provider: string | null; status: string };
  database: string;
  checkedAt: string;
};

function Section({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="comms-panel p-5">
      <div className="text-sm font-bold text-slate-100">{title}</div>
      <div className="text-[11px] text-slate-500 mt-0.5 mb-4">{desc}</div>
      {children}
    </div>
  );
}

export default function CommsSettings({ user }: { user: LpUser }) {
  const [wa, setWa] = useState<WaMasked | null>(null);
  const [calling, setCalling] = useState<CallingMasked | null>(null);
  const [providers, setProviders] = useState<{ id: string; label: string; available: boolean }[]>([]);
  const [providerFields, setProviderFields] = useState<Record<string, ProviderField[]>>({});
  const [health, setHealth] = useState<Health | null>(null);
  const [waTest, setWaTest] = useState<{ ok: boolean; msg: string } | null>(null);
  const [callTest, setCallTest] = useState<{ ok: boolean; msg: string } | null>(null);
  const [callForm, setCallForm] = useState<Record<string, string>>({});
  const [savingCall, setSavingCall] = useState(false);
  const isSuper = user.role === "super_admin";

  const load = useCallback(async () => {
    try {
      const [w, c, h] = await Promise.all([
        api<{ whatsapp: WaMasked & { connected: boolean } }>("/api/lp/integrations/whatsapp"),
        api<{ calling: CallingMasked; supportedProviders: { id: string; label: string; available: boolean }[]; providerFields?: Record<string, ProviderField[]> }>("/api/lp/integrations/calling"),
        api<Health>("/api/lp/communications/health"),
      ]);
      setWa(w.whatsapp ?? null);
      setCalling(c.calling);
      setProviders(c.supportedProviders);
      setProviderFields(c.providerFields || {});
      setHealth(h);
      setCallForm(c.calling.fields || {});
    } catch { /* viewer role — sections degrade */ }
  }, []);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 30000); return () => clearInterval(t); }, [load]);

  const testWhatsApp = async () => {
    setWaTest(null);
    try {
      await api("/api/lp/integrations/whatsapp", { method: "PUT" });
      setWaTest({ ok: true, msg: "✓ Connected — Meta verified the credentials against the live Graph API." });
    } catch (e) {
      setWaTest({ ok: false, msg: `✕ Connection failed — ${e instanceof Error ? e.message : "unknown error"}` });
    }
    void load();
  };

  const saveCalling = async () => {
    setSavingCall(true);
    try {
      await api("/api/lp/integrations/calling", { method: "PUT", body: JSON.stringify(callForm) });
      setCallTest({ ok: true, msg: "Configuration saved (secrets stay server-side)." });
      await load();
    } catch (e) {
      setCallTest({ ok: false, msg: e instanceof Error ? e.message : "save failed" });
    } finally { setSavingCall(false); }
  };

  const testCalling = async () => {
    setCallTest(null);
    try {
      const d = await api<{ ok: boolean; status?: string; error?: string; detail?: { detail?: string } }>("/api/lp/integrations/calling", { method: "POST", body: JSON.stringify({ action: "test" }) });
      if (d.ok) setCallTest({ ok: true, msg: `✓ ${d.status}${d.detail?.detail ? ` — ${d.detail.detail}` : ""}` });
      else setCallTest({ ok: false, msg: d.error || "✕ Connection failed" });
    } catch (e) {
      setCallTest({ ok: false, msg: e instanceof Error ? e.message : "test failed" });
    }
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const webhookUrl = `${origin}/api/lp/webhooks/whatsapp`;

  return (
    <div className="h-full overflow-y-auto comms-scroll p-4 lg:p-6">
      <div className="max-w-4xl mx-auto space-y-5">
        {/* WhatsApp */}
        <Section title="WhatsApp Business (Meta Cloud API)" desc="Credentials are stored server-side and masked over the API. The test below hits the live Graph API.">
          {wa ? (
            <>
              <div className="grid sm:grid-cols-2 gap-2.5 text-[11px]">
                {[
                  ["Status", wa.connected ? "CONNECTED" : "NOT CONFIGURED"],
                  ["Phone Number ID", wa.phoneNumberId || "—"],
                  ["WABA ID", wa.wabaId || "—"],
                  ["Graph version", wa.graphVersion],
                  ["Access token", wa.hasAccessToken ? `${wa.accessTokenMask} (stored server-side)` : "not set"],
                  ["Webhook verify token", wa.webhookVerifyToken || "—"],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-xl border border-[var(--cm-border)] px-3 py-2 flex justify-between gap-2">
                    <span className="text-slate-500">{k}</span>
                    <span className={cn("text-right font-mono", k === "Status" ? (wa.connected ? "text-[#4ade80] font-sans font-semibold" : "text-slate-400 font-sans") : "text-slate-300")}>{v}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-3">
                <button onClick={() => void testWhatsApp()} disabled={!isSuper}
                  className="h-9 px-4 rounded-xl comms-btn-primary text-white text-xs font-semibold transition disabled:opacity-40">
                  TEST CONNECTION
                </button>
                {!isSuper && <span className="text-[10px] text-slate-500">super admin only</span>}
              </div>
              {waTest && <div className={cn("mt-2.5 text-[11px] rounded-xl px-3 py-2 border", waTest.ok ? "text-[#4ade80] border-[#25d366]/30 bg-[rgba(37,211,102,0.06)]" : "text-[#f87171] border-[#f87171]/30 bg-[rgba(248,113,113,0.06)]")}>{waTest.msg}</div>}
            </>
          ) : <div className="text-xs text-slate-500">Integrations API requires admin access.</div>}
        </Section>

        {/* Calling provider */}
        <Section title="Calling Provider (SIP / VoIP)" desc="Browser + server calling through the provider adapter layer. No credentials saved = calls honestly disabled.">
          {calling && providers ? (
            <>
              <div className="grid sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-slate-500">Provider</label>
                  <select value={callForm.provider || ""} onChange={(e) => setCallForm((f) => ({ ...f, provider: e.target.value }))}
                    disabled={!isSuper} className="comms-input w-full h-9 px-2 text-xs mt-1">
                    <option value="">— not configured —</option>
                    {providers.map((p) => <option key={p.id} value={p.id}>{p.label}{p.available ? "" : " (adapter coming soon)"}</option>)}
                  </select>
                </div>
                {(providerFields[callForm.provider || ""] || []).map((f) => (
                  <div key={f.key}>
                    <label className="text-[10px] uppercase tracking-wider text-slate-500">{f.label}</label>
                    <input type={f.sensitive ? "password" : "text"} value={callForm[f.key] || ""}
                      onChange={(e) => setCallForm((prev) => ({ ...prev, [f.key]: e.target.value }))} disabled={!isSuper}
                      placeholder={f.placeholder} className="comms-input w-full h-9 px-3 text-xs mt-1" />
                  </div>
                ))}
                {!providerFields[callForm.provider || ""] && (
                  <div className="sm:col-span-2 text-[11px] text-slate-500">Select a provider to show its credential fields.</div>
                )}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button onClick={() => void saveCalling()} disabled={!isSuper || savingCall}
                  className="h-9 px-4 rounded-xl comms-chip text-slate-200 text-xs font-semibold transition hover:border-[var(--cm-border-strong)] disabled:opacity-40">
                  {savingCall ? "Saving…" : "Save configuration"}
                </button>
                <button onClick={() => void testCalling()} className="h-9 px-4 rounded-xl comms-btn-primary text-white text-xs font-semibold transition">
                  TEST CONNECTION
                </button>
                <span className="text-[10px] text-slate-500">current state: <b className={calling.configured ? "text-slate-300" : "text-slate-500"}>{calling.configured ? `${calling.provider} · ${calling.adapterLabel}` : "NOT CONFIGURED"}</b></span>
              </div>
              {callTest && <div className={cn("mt-2.5 text-[11px] rounded-xl px-3 py-2 border", callTest.ok ? "text-[#4ade80] border-[#25d366]/30 bg-[rgba(37,211,102,0.06)]" : "text-[#f87171] border-[#f87171]/30 bg-[rgba(248,113,113,0.06)]")}>{callTest.msg}</div>}
              <div className="mt-3 text-[10px] text-slate-600 leading-relaxed">
                Twilio mode places REAL two-leg calls: Twilio rings the agent's phone (or the saved bridge number), then bridges to the customer — placement, live state, ending and history all live here. Secrets stay server-side and masked in every API response. Media-level controls (mute, hold, DTMF, transfer) are not possible on PSTN legs — they stay visibly disabled (UNAVAILABLE WITH CURRENT PROVIDER) instead of being simulated.
              </div>
            </>
          ) : <div className="text-xs text-slate-500">Integrations API requires admin access.</div>}
        </Section>

        {/* Webhooks */}
        <Section title="Webhooks" desc="Point your Meta App's WhatsApp webhook here. Verification uses the hub.verify_token challenge.">
          <div className="space-y-2 text-[11px]">
            <div className="rounded-xl border border-[var(--cm-border)] px-3 py-2 flex justify-between gap-3 items-center">
              <span className="text-slate-500 shrink-0">Callback URL</span>
              <code className="text-slate-300 font-mono text-[10px] text-right break-all">{webhookUrl}</code>
            </div>
            <div className="rounded-xl border border-[var(--cm-border)] px-3 py-2 flex justify-between gap-3">
              <span className="text-slate-500">Verify token</span>
              <code className="text-slate-300 font-mono text-[10px]">playbeat-leadpulse-verify</code>
            </div>
            {health && (
              <div className="rounded-xl border border-[var(--cm-border)] px-3 py-2.5 grid grid-cols-3 gap-2 text-center">
                <div><div className="text-slate-200 font-semibold">{health.webhook.received24h}</div><div className="text-[9px] text-slate-500 uppercase">events / 24h</div></div>
                <div><div className={cn("font-semibold", health.webhook.failed24h > 0 ? "text-[#f87171]" : "text-slate-200")}>{health.webhook.failed24h}</div><div className="text-[9px] text-slate-500 uppercase">failed / 24h</div></div>
                <div><div className="text-slate-200 font-semibold">{health.webhook.lastEventAt ? timeAgo(health.webhook.lastEventAt) : "—"}</div><div className="text-[9px] text-slate-500 uppercase">last event</div></div>
              </div>
            )}
            <div className="text-[10px] text-slate-600 leading-relaxed">
              Subscribe the <b>messages</b> field in your Meta App dashboard (WhatsApp → Configuration). Inbound messages are de-duplicated by provider message id, normalized, stored in MongoDB and pushed to the inbox.
            </div>
          </div>
        </Section>

        {/* System health */}
        <Section title="System health" desc="Live probes — refreshed every 30 seconds.">
          {health ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {[
                { label: "WhatsApp", state: health.whatsapp.status, detail: health.whatsapp.detail || (health.whatsapp.latencyMs ? `${health.whatsapp.latencyMs} ms` : "") },
                { label: "Webhook", state: health.webhook.status, detail: `last ${timeAgo(health.webhook.lastEventAt)} ago` },
                { label: "Calling", state: health.calling.status, detail: health.calling.provider || "no provider" },
                { label: "Database", state: health.database, detail: "MongoDB Atlas" },
              ].map((s) => (
                <div key={s.label} className="rounded-xl border border-[var(--cm-border)] p-3">
                  <div className="flex items-center gap-2">
                    <StatusDot state={s.state as "connected"} />
                    <span className="text-xs font-semibold text-slate-200">{s.label}</span>
                    <span className="ml-auto text-[9px] uppercase tracking-wider" style={{ color: s.state === "connected" || s.state === "healthy" || s.state === "configured" ? "#4ade80" : s.state === "not_configured" ? "#94a3b8" : "#fbbf24" }}>{s.state.replace(/_/g, " ")}</span>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1 truncate">{s.detail}</div>
                </div>
              ))}
            </div>
          ) : <div className="text-xs text-slate-500">Loading health…</div>}
        </Section>
      </div>
    </div>
  );
}
