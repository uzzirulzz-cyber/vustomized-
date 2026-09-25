// Lead Pulse — telephony provider adapter layer (spec §20).
//
// The CRM never hardwires itself to one calling provider. Every call action
// goes through CallingProviderAdapter; today NO telephony credentials exist,
// so the active adapter is the honest NotConfiguredAdapter: every operation
// reports "not configured" and NOTHING is simulated (spec §24/§26).
//
// When an administrator supplies real SIP/WebRTC credentials under
// Settings → Communications, a provider adapter can be registered here and
// the same API surface becomes operational — zero UI rewrites.
import { db } from "@/lib/db";
import { TwilioAdapter, isTwilioConfig } from "./calling-twilio";

export type ProviderResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; errorCode?: string | number; httpStatus?: number };

export type CallState = "ringing" | "connected" | "hold" | "ended" | "failed";

export type CallSessionInfo = {
  callId: string;
  state: CallState;
  direction: "inbound" | "outbound";
  from: string;
  to: string;
  startedAt?: string;
  answeredAt?: string;
  endedAt?: string;
};

export interface CallingProviderAdapter {
  readonly id: string;
  readonly label: string;
  /** Capability matrix for honest UI gating (mute/hold/DTMF… enabled or visibly disabled). */
  readonly capabilities?: Record<string, boolean>;
  /** Real reachability/registration check against the provider. */
  healthCheck(): Promise<ProviderResult<{ registered: boolean; latencyMs?: number; detail?: string }>>;
  registerAgent(ext: string): Promise<ProviderResult<unknown>>;
  startCall(from: string, to: string): Promise<ProviderResult<{ callId: string }>>;
  answerCall(callId: string): Promise<ProviderResult<unknown>>;
  rejectCall(callId: string): Promise<ProviderResult<unknown>>;
  hangup(callId: string): Promise<ProviderResult<unknown>>;
  mute(callId: string): Promise<ProviderResult<unknown>>;
  unmute(callId: string): Promise<ProviderResult<unknown>>;
  hold(callId: string): Promise<ProviderResult<unknown>>;
  resume(callId: string): Promise<ProviderResult<unknown>>;
  sendDTMF(callId: string, digit: string): Promise<ProviderResult<unknown>>;
  transfer(callId: string, target: string): Promise<ProviderResult<unknown>>;
  getCallStatus(callId: string): Promise<ProviderResult<CallSessionInfo>>;
}

export const NOT_CONFIGURED_ERROR =
  "Calling provider is NOT CONFIGURED — no SIP/VoIP credentials have been saved. Calls cannot be placed or received. Configure a provider under Communications → Settings → Calling Provider.";

/** The honest default: telephony operations are unavailable, never faked. */
export class NotConfiguredAdapter implements CallingProviderAdapter {
  readonly id = "not_configured";
  readonly label = "No calling provider configured";
  readonly capabilities: Record<string, boolean> = {
    hangup: false, answer: false, reject: false, mute: false, unmute: false,
    hold: false, resume: false, dtmf: false, transfer: false,
  };
  private fail(): ProviderResult<never> {
    return { ok: false, error: NOT_CONFIGURED_ERROR, errorCode: "calling_not_configured" };
  }
  async healthCheck() { return this.fail(); }
  async registerAgent() { return this.fail(); }
  async startCall() { return this.fail(); }
  async answerCall() { return this.fail(); }
  async rejectCall() { return this.fail(); }
  async hangup() { return this.fail(); }
  async mute() { return this.fail(); }
  async unmute() { return this.fail(); }
  async hold() { return this.fail(); }
  async resume() { return this.fail(); }
  async sendDTMF() { return this.fail(); }
  async transfer() { return this.fail(); }
  async getCallStatus() { return this.fail(); }
}

// Adapter registry — add provider-specific adapters here (Twilio SIP, Asterisk
// ARI, Telnyx, Plivo, Genesys…). Each adapter reads its own secret material
// server-side; credentials NEVER reach the browser.
// Twilio is registered: it activates ONLY when a real Twilio configuration is
// saved (accountSid + authToken + fromNumber + agentPhone) — otherwise the
// honest NotConfiguredAdapter stays in charge.
function resolveCallingAdapter(cfg: CallingConfig): CallingProviderAdapter {
  if (cfg.provider === "twilio" && isTwilioConfig(cfg)) return new TwilioAdapter(cfg);
  // "generic_sip": new GenericSipAdapter(cfg), // ← enabled once real SIP credentials exist
  return new NotConfiguredAdapter();
}

export type CallingConfigMasked = {
  configured: boolean;
  provider: string | null;
  adapterId: string;
  adapterLabel: string;
  fields: Record<string, string>; // masked values only
  capabilities: Record<string, boolean>; // honest UI gating
};

type CallingConfig = Record<string, string>; // provider, sipDomain, username, password, …
const SENSITIVE_KEYS = new Set(["password", "sipPassword", "token", "apiKey", "apiSecret", "authToken", "registrationToken"]);

export async function getCallingConfigRaw(): Promise<CallingConfig> {
  const row = await db.integration.findUnique({ where: { provider: "telephony" } });
  if (!row) return {};
  try { return JSON.parse(row.configJson) as CallingConfig; } catch { return {}; }
}

export async function getCallingConfigMasked(): Promise<CallingConfigMasked> {
  const cfg = await getCallingConfigRaw();
  const provider = cfg.provider || null;
  const adapter = resolveCallingAdapter(cfg);
  const configured = Boolean(provider) && Object.keys(cfg).length > 1 && adapter.id !== "not_configured";
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(cfg)) {
    if (k === "provider") continue;
    fields[k] = SENSITIVE_KEYS.has(k)
      ? (v ? `••••••••${v.slice(-2)}` : "")
      : v;
  }
  return {
    configured,
    provider,
    adapterId: adapter.id,
    adapterLabel: adapter.label,
    fields,
    capabilities: adapter.capabilities ?? {},
  };
}

export async function saveCallingConfig(patch: CallingConfig): Promise<void> {
  const current = await getCallingConfigRaw();
  const next: CallingConfig = { ...current, ...patch };
  for (const [k, v] of Object.entries(next)) {
    if (v === "") { delete next[k]; continue; }
    // Masked echo guard: the settings form round-trips masked secrets
    // (••••••••XX). Never let a mask overwrite or replace the stored secret.
    if (k !== "provider" && v.startsWith("••••••••")) {
      if (current[k] && current[k] !== v) next[k] = current[k];
      else delete next[k];
    }
  }
  const configured = Boolean(next.provider);
  await db.integration.upsert({
    where: { provider: "telephony" },
    create: { provider: "telephony", configJson: JSON.stringify(next), connected: configured },
    update: { configJson: JSON.stringify(next), connected: configured },
  });
}

export async function getCallingAdapter(): Promise<CallingProviderAdapter> {
  // Config-aware resolution: returns the REAL provider adapter when valid
  // credentials are saved, otherwise the honest NotConfiguredAdapter.
  const cfg = await getCallingConfigRaw();
  return resolveCallingAdapter(cfg);
}

export async function listSupportedCallingProviders(): Promise<{ id: string; label: string; available: boolean }[]> {
  return [
    { id: "generic_sip", label: "Generic SIP / PBX (WebSocket SIP.js)", available: false },
    { id: "twilio", label: "Twilio Programmable Voice", available: true },
    { id: "telnyx", label: "Telnyx Voice", available: false },
    { id: "plivo", label: "Plivo Voice", available: false },
  ];
}

/** Per-provider credential field hints the Settings form renders dynamically. */
export const CALLING_PROVIDER_FIELDS: Record<string, { key: string; label: string; placeholder: string; sensitive?: boolean }[]> = {
  twilio: [
    { key: "accountSid", label: "Account SID", placeholder: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
    { key: "authToken", label: "Auth Token", placeholder: "••••••••", sensitive: true },
    { key: "fromNumber", label: "Twilio caller number (from)", placeholder: "+15551234567" },
    { key: "agentPhone", label: "Agent bridge number (default)", placeholder: "+9233xxxxxxxxx — agent's own phone overrides if set" },
    { key: "callbackBaseUrl", label: "Public base URL for status callbacks", placeholder: "https://playbeat.digital" },
  ],
  generic_sip: [
    { key: "sipDomain", label: "SIP domain / PBX host", placeholder: "sip.yourpbx.com" },
    { key: "username", label: "Agent extension / username", placeholder: "agent-101" },
    { key: "password", label: "Password / registration secret", placeholder: "••••••••", sensitive: true },
  ],
};
