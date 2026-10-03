// Lead Pulse — Facebook Page / Messenger provider (official Graph API only).
//
// Honesty rules (spec §25): every function returns the REAL provider result.
// The Page channel uses the Messenger Send API (POST /{page-id}/messages) and
// Page node reads (GET /{page-id}) for credential verification. Nothing is
// fabricated — a blocked/invalid token surfaces Meta's own error verbatim.
import { db } from "@/lib/db";

const GRAPH_BASE = "https://graph.facebook.com";

export type FacebookConfig = {
  pageId: string;
  pageName: string; // filled from the verify response when available
  accessToken: string;
  graphVersion: string;
  webhookVerifyToken: string;
  lastVerifyOk: boolean; // result of the LAST real Graph verification
  lastVerifyError: string; // "" when the last verify succeeded
  lastVerifyAt: string; // ISO timestamp of the last verify attempt
};

const DEFAULTS: FacebookConfig = {
  pageId: "",
  pageName: "",
  accessToken: "",
  graphVersion: "v25.0",
  webhookVerifyToken: "playbeat-leadpulse-fb-verify",
  lastVerifyOk: false,
  lastVerifyError: "",
  lastVerifyAt: "",
};

export async function getFacebookConfig(): Promise<FacebookConfig & { connected: boolean }> {
  const row = await db.integration.findUnique({ where: { provider: "facebook" } });
  let cfg = { ...DEFAULTS };
  if (row) {
    try {
      cfg = { ...cfg, ...(JSON.parse(row.configJson) as Partial<FacebookConfig>) };
    } catch { /* keep defaults */ }
  }
  const connected = Boolean(cfg.pageId && cfg.accessToken);
  return { ...cfg, connected };
}

export function maskFacebookConfig(cfg: FacebookConfig & { connected: boolean }) {
  return {
    pageId: cfg.pageId || "",
    pageName: cfg.pageName || "",
    graphVersion: cfg.graphVersion,
    webhookVerifyToken: cfg.webhookVerifyToken ? "••••••••" : "",
    hasAccessToken: Boolean(cfg.accessToken),
    accessTokenMask: cfg.accessToken ? `${cfg.accessToken.slice(0, 6)}…${cfg.accessToken.slice(-4)}` : "",
    lastVerifyOk: cfg.lastVerifyOk,
    lastVerifyError: cfg.lastVerifyError,
    lastVerifyAt: cfg.lastVerifyAt,
    connected: cfg.connected,
  };
}

export async function saveFacebookConfig(patch: Partial<FacebookConfig>): Promise<void> {
  const current = await getFacebookConfig();
  const next = { ...current, ...patch };
  await db.integration.upsert({
    where: { provider: "facebook" },
    create: { provider: "facebook", configJson: JSON.stringify(next), connected: Boolean(next.pageId && next.accessToken) },
    update: { configJson: JSON.stringify(next), connected: Boolean(next.pageId && next.accessToken) },
  });
}

export type ProviderResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; errorCode?: string | number; httpStatus?: number };

export type SendResult =
  | { ok: true; fbMessageId: string }
  | { ok: false; error: string; errorCode?: string | number; httpStatus?: number };

async function graph<T>(path: string, init: RequestInit & { token: string; version: string }): Promise<ProviderResult<T>> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(`${GRAPH_BASE}/${init.version}/${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${init.token}`,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = (body as { error?: { message?: string; code?: number } }).error;
      return {
        ok: false,
        error: err?.message || `Graph API HTTP ${res.status}`,
        errorCode: err?.code,
        httpStatus: res.status,
      };
    }
    return { ok: true, data: body as T };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : "network error calling Graph API" };
  }
}

/** Verify Page credentials against the real Graph API (Page node read).
 *  Returns the real Page name/id — or Meta's own error (e.g. the platform's
 *  "API access blocked." when the token's app has API access disabled). */
export async function fbVerifyCredentials(): Promise<ProviderResult<{ pageId?: string; pageName?: string; category?: string }>> {
  const cfg = await getFacebookConfig();
  const result = await graph<{ id?: string; name?: string; category?: string }>(
    cfg.pageId ? `${cfg.pageId}?fields=id,name,category` : "me?fields=id,name,category",
    { method: "GET", token: cfg.accessToken, version: cfg.graphVersion }
  );
  // Record the honest verification outcome on the config row (spec §46 API Health).
  await saveFacebookConfig({
    lastVerifyOk: result.ok,
    lastVerifyError: result.ok ? "" : result.error,
    lastVerifyAt: new Date().toISOString(),
    ...(result.ok && result.data?.name ? { pageName: result.data.name } : {}),
    ...(result.ok && !cfg.pageId && result.data?.id ? { pageId: result.data.id } : {}),
  });
  return result;
}

/** Send a free-form text message to a Messenger PSID through the Page.
 *  Meta only permits this inside the 24h messaging window (opened by the
 *  user's last message to the Page) — rejections are surfaced verbatim. */
export async function fbSendText(psid: string, body: string): Promise<SendResult> {
  const cfg = await getFacebookConfig();
  if (!cfg.connected) return { ok: false, error: "Facebook Page not connected — configure credentials in Integrations first." };
  const res = await graph<{ message_id?: string; recipient_id?: string }>(
    `${cfg.pageId}/messages`,
    {
      method: "POST",
      token: cfg.accessToken,
      version: cfg.graphVersion,
      body: JSON.stringify({
        messaging_type: "RESPONSE",
        recipient: { id: psid },
        message: { text: body.slice(0, 2000) },
      }),
    }
  );
  if (!res.ok) return res;
  return { ok: true, fbMessageId: res.data.message_id ?? "" };
}
