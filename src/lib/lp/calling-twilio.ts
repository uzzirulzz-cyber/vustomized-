// Lead Pulse — Twilio Programmable Voice adapter (spec §20).
//
// REAL provider integration, registered server-side. Credentials live in
// Integration.configJson (provider="telephony") and NEVER reach the browser.
//
// Mode: PSTN two-leg bridge (works with ONLY Account SID + Auth Token + a
// Twilio-owned caller number):
//   1. Twilio rings the AGENT's phone (User.phone, or the saved agentPhone).
//   2. When the agent answers, TwiML <Dial> bridges them to the customer.
// The CRM owns placement, live state, ending and history — nothing opens in
// another app or device UI.
//
// HONESTY (spec §24/§26): media-level controls (mute/hold/DTMF/transfer) are
// not possible on PSTN legs — every such operation refuses with
// calling_capability_unavailable and the UI keeps those controls visibly
// disabled ("UNAVAILABLE WITH CURRENT PROVIDER"). Nothing is simulated.
import type { CallingProviderAdapter, CallState, CallSessionInfo, ProviderResult } from "./calling";

const TWILIO_API = "https://api.twilio.com/2010-04-01";

export type TwilioConfig = {
  accountSid: string;   // AC… (32 hex)
  authToken: string;    // secret
  fromNumber: string;   // Twilio-owned caller ID, E.164
  agentPhone: string;   // default agent bridge target, E.164 (per-agent override: User.phone)
  callbackBaseUrl: string; // public base for status callbacks, e.g. https://playbeat.digital
};

export const TWILIO_REQUIRED_FIELDS = ["accountSid", "authToken", "fromNumber", "agentPhone"] as const;

export function isTwilioConfig(cfg: Record<string, string>): cfg is TwilioConfig {
  return TWILIO_REQUIRED_FIELDS.every((k) => typeof cfg[k] === "string" && cfg[k].length > 0);
}

export class TwilioAdapter implements CallingProviderAdapter {
  readonly id = "twilio";
  readonly label = "Twilio Programmable Voice";
  /** Capability matrix the UI uses to enable/disable call controls honestly. */
  readonly capabilities: Record<string, boolean> = {
    hangup: true,
    answer: false,
    reject: false,
    mute: false,
    unmute: false,
    hold: false,
    resume: false,
    dtmf: false,
    transfer: false,
  };

  constructor(private cfg: TwilioConfig) {}

  private authHeader(): string {
    return "Basic " + Buffer.from(`${this.cfg.accountSid}:${this.cfg.authToken}`).toString("base64");
  }

  /** Fail-closed capability refusals — never simulated. */
  private unsupported(op: string): ProviderResult<never> {
    return {
      ok: false,
      error: `${op.toUpperCase()} is UNAVAILABLE WITH THE CURRENT PROVIDER — Twilio PSTN bridge mode places and ends real calls, but media-level controls (mute/hold/DTMF/transfer) require a WebRTC (Voice SDK) connection. The control stays disabled; nothing is simulated.`,
      errorCode: "calling_capability_unavailable",
    };
  }

  private async twilioFetch(path: string, form?: Record<string, string> | [string, string][], method: "GET" | "POST" = "POST"): Promise<ProviderResult<Record<string, unknown>>> {
    const started = Date.now();
    try {
      const res = await fetch(`${TWILIO_API}${path}`, {
        method,
        headers: { authorization: this.authHeader(), "content-type": "application/x-www-form-urlencoded" },
        body: method === "POST" && form ? new URLSearchParams(form as [string, string][]) : undefined,
        signal: AbortSignal.timeout(15000),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        const code = (data.code as number) ?? res.status;
        const msg = (data.message as string) || `Twilio HTTP ${res.status}`;
        return { ok: false, error: `Twilio: ${msg} (code ${code})`, errorCode: code, httpStatus: res.status };
      }
      return { ok: true, data: { ...data, _latencyMs: Date.now() - started } };
    } catch (e) {
      return { ok: false, error: `Twilio API unreachable: ${e instanceof Error ? e.message : "network error"}`, errorCode: "twilio_network" };
    }
  }

  async healthCheck(): Promise<ProviderResult<{ registered: boolean; latencyMs?: number; detail?: string }>> {
    // REAL check against the Twilio REST API: account fetch + caller-number ownership.
    const acct = await this.twilioFetch(`/Accounts/${this.cfg.accountSid}.json`, undefined, "GET");
    if (!acct.ok) return { ok: false, error: acct.error, errorCode: acct.errorCode, httpStatus: acct.httpStatus };
    const status = (acct.data.status as string) || "unknown";
    const latencyMs = acct.data._latencyMs as number;

    // Validate the caller number actually belongs to THIS account (catches typo'd/migrated numbers).
    const num = await this.twilioFetch(`/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(this.cfg.fromNumber)}&PageSize=1`, undefined, "GET");
    if (!num.ok) {
      return { ok: false, error: `Account reachable (status ${status}) but caller-number check failed: ${num.error}`, errorCode: num.errorCode, httpStatus: num.httpStatus };
    }
    const list = (num.data.incoming_phone_numbers as unknown[] | undefined) ?? [];
    if (list.length === 0) {
      return { ok: false, error: `Number ${this.cfg.fromNumber} is NOT owned by this Twilio account — buy it or verify it as an Outgoing Caller ID first.`, errorCode: "twilio_number_not_owned" };
    }
    return {
      ok: true,
      data: {
        registered: true,
        latencyMs,
        detail: `Twilio account active (status ${status}) · caller ${this.cfg.fromNumber} verified on this account · agent bridge ${this.cfg.agentPhone}`,
      },
    };
  }

  async registerAgent(): Promise<ProviderResult<unknown>> {
    // PSTN bridge mode has no SIP registration step — the agent's phone IS the endpoint.
    return { ok: true, data: { registered: true, detail: "Twilio PSTN bridge mode: no SIP registration required." } };
  }

  async startCall(agentUserId: string, to: string): Promise<ProviderResult<{ callId: string }>> {
    const { db } = await import("@/lib/db");
    // Bridge target: the calling agent's own number when set, else the saved default.
    let bridge = this.cfg.agentPhone;
    if (agentUserId) {
      const agent = await db.user.findUnique({ where: { id: agentUserId }, select: { phone: true } });
      if (agent?.phone && agent.phone.replace(/\D/g, "").length >= 8) bridge = agent.phone;
    }
    const base = (this.cfg.callbackBaseUrl || "https://playbeat.digital").replace(/\/+$/, "");
    const twiml =
      `<?xml version="1.0" encoding="UTF-8"?><Response><Dial callerId="${this.cfg.fromNumber}">${to}</Dial></Response>`;
    const created = await this.twilioFetch(`/Calls.json`, [
      ["To", bridge],
      ["From", this.cfg.fromNumber],
      ["Twiml", twiml],
      ["StatusCallback", `${base}/api/lp/webhooks/twilio`],
      ["StatusCallbackEvent", "initiated"],
      ["StatusCallbackEvent", "ringing"],
      ["StatusCallbackEvent", "answered"],
      ["StatusCallbackEvent", "completed"],
      ["StatusCallbackMethod", "POST"],
    ]);
    if (!created.ok) return { ok: false, error: created.error, errorCode: created.errorCode, httpStatus: created.httpStatus };
    return { ok: true, data: { callId: created.data.sid as string } };
  }

  async answerCall(): Promise<ProviderResult<unknown>> { return this.unsupported("answer"); }
  async rejectCall(): Promise<ProviderResult<unknown>> { return this.unsupported("reject"); }
  async mute(): Promise<ProviderResult<unknown>> { return this.unsupported("mute"); }
  async unmute(): Promise<ProviderResult<unknown>> { return this.unsupported("unmute"); }
  async hold(): Promise<ProviderResult<unknown>> { return this.unsupported("hold"); }
  async resume(): Promise<ProviderResult<unknown>> { return this.unsupported("resume"); }
  async sendDTMF(): Promise<ProviderResult<unknown>> { return this.unsupported("DTMF"); }
  async transfer(): Promise<ProviderResult<unknown>> { return this.unsupported("transfer"); }

  async hangup(callId: string): Promise<ProviderResult<unknown>> {
    const res = await this.twilioFetch(`/Calls/${callId}.json`, { Status: "completed" });
    if (!res.ok) return { ok: false, error: res.error, errorCode: res.errorCode, httpStatus: res.httpStatus };
    return { ok: true, data: { status: res.data.status } };
  }

  async getCallStatus(callId: string): Promise<ProviderResult<CallSessionInfo>> {
    const res = await this.twilioFetch(`/Calls/${callId}.json`, undefined, "GET");
    if (!res.ok) return { ok: false, error: res.error, errorCode: res.errorCode, httpStatus: res.httpStatus };
    const map: Record<string, CallState> = {
      queued: "ringing", ringing: "ringing",
      "in-progress": "connected",
      completed: "ended", busy: "ended", "no-answer": "ended", canceled: "ended",
      failed: "failed",
    };
    const state = map[(res.data.status as string) || ""] || "ended";
    return {
      ok: true,
      data: {
        callId,
        state,
        direction: "outbound",
        from: (res.data.from as string) || this.cfg.fromNumber,
        to: (res.data.to as string) || "",
        startedAt: res.data.start_time as string | undefined,
        answeredAt: res.data.answered_time as string | undefined,
        endedAt: res.data.end_time as string | undefined,
      },
    };
  }
}

/** Validate X-Twilio-Signature (HMAC-SHA1 over URL + sorted params) — fail-closed. */
export function validateTwilioSignature(authToken: string, url: string, params: Record<string, string>, signature: string): boolean {
  const crypto = require("crypto") as typeof import("crypto");
  const mac = crypto.createHmac("sha1", authToken);
  mac.update(Buffer.from(url, "utf-8"));
  for (const key of Object.keys(params).sort()) {
    mac.update(Buffer.from(key, "utf-8"));
    mac.update(Buffer.from(params[key] ?? "", "utf-8"));
  }
  const expected = mac.digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature || "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
