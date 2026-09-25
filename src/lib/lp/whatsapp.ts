// Lead Pulse — Meta WhatsApp Cloud API provider (official Graph API only).
//
// Honesty rules (spec §25): every function returns the REAL provider result.
// There is no telephony/calling API in the Cloud Platform — the UI therefore
// exposes device-level actions (wa.me deep link, tel: click-to-call) and
// post-call outcome logging, clearly labeled as such. Nothing is fabricated.
import { db } from "@/lib/db";

const GRAPH_BASE = "https://graph.facebook.com";

export type WhatsAppConfig = {
  phoneNumberId: string;
  wabaId: string;
  accessToken: string;
  graphVersion: string;
  webhookVerifyToken: string;
};

const DEFAULTS: WhatsAppConfig = {
  phoneNumberId: "",
  wabaId: "",
  accessToken: "",
  graphVersion: "v21.0",
  webhookVerifyToken: "playbeat-leadpulse-verify",
};

export async function getWhatsAppConfig(): Promise<WhatsAppConfig & { connected: boolean }> {
  const row = await db.integration.findUnique({ where: { provider: "whatsapp" } });
  let cfg = { ...DEFAULTS };
  if (row) {
    try {
      cfg = { ...cfg, ...(JSON.parse(row.configJson) as Partial<WhatsAppConfig>) };
    } catch { /* keep defaults */ }
  }
  const connected = Boolean(cfg.phoneNumberId && cfg.accessToken && cfg.wabaId);
  return { ...cfg, connected };
}

export function maskConfig(cfg: WhatsAppConfig & { connected: boolean }) {
  return {
    phoneNumberId: cfg.phoneNumberId || "",
    wabaId: cfg.wabaId || "",
    graphVersion: cfg.graphVersion,
    webhookVerifyToken: cfg.webhookVerifyToken ? "••••••••" : "",
    hasAccessToken: Boolean(cfg.accessToken),
    accessTokenMask: cfg.accessToken ? `${cfg.accessToken.slice(0, 6)}…${cfg.accessToken.slice(-4)}` : "",
    connected: cfg.connected,
  };
}

export async function saveWhatsAppConfig(patch: Partial<WhatsAppConfig>): Promise<void> {
  const current = await getWhatsAppConfig();
  const next = { ...current, ...patch };
  await db.integration.upsert({
    where: { provider: "whatsapp" },
    create: { provider: "whatsapp", configJson: JSON.stringify(next), connected: Boolean(next.phoneNumberId && next.accessToken && next.wabaId) },
    update: { configJson: JSON.stringify(next), connected: Boolean(next.phoneNumberId && next.accessToken && next.wabaId) },
  });
}

// ─── Graph API calls (real results only) ─────────────────────────────────────

export type ProviderResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; errorCode?: string | number; httpStatus?: number };

// Send-path results carry the Meta message id directly (used by the send,
// campaign-tick and dialer flows to record waMessageId on the message row).
export type SendResult =
  | { ok: true; waMessageId: string }
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

/** Send a free-form text message. Meta only permits this INSIDE the 24h
 *  customer service window (i.e. after the customer last messaged you).
 *  Outside it, Meta returns error 131047 — we surface that verbatim. */
export async function waSendText(
  to: string,
  body: string,
  contextWaMessageId?: string | null
): Promise<SendResult> {
  const cfg = await getWhatsAppConfig();
  if (!cfg.connected) return { ok: false, error: "WhatsApp not connected — configure credentials in Integrations first." };
  const res = await graph<{ messages?: { id: string }[] }>(
    `${cfg.phoneNumberId}/messages`,
    {
      method: "POST",
      token: cfg.accessToken,
      version: cfg.graphVersion,
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body },
        ...(contextWaMessageId ? { context: { message_id: contextWaMessageId } } : {}),
      }),
    }
  );
  if (!res.ok) return res;
  return { ok: true, waMessageId: res.data.messages?.[0]?.id ?? "" };
}

/** Send an APPROVED template (the only Meta-sanctioned way to start a
 *  business-initiated conversation outside the 24h window). */
export async function waSendTemplate(
  to: string,
  templateName: string,
  language: string,
  bodyParams: string[],
  contextWaMessageId?: string | null
): Promise<SendResult> {
  const cfg = await getWhatsAppConfig();
  if (!cfg.connected) return { ok: false, error: "WhatsApp not connected — configure credentials in Integrations first." };
  const res = await graph<{ messages?: { id: string }[] }>(
    `${cfg.phoneNumberId}/messages`,
    {
      method: "POST",
      token: cfg.accessToken,
      version: cfg.graphVersion,
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: language },
          ...(bodyParams.length
            ? { components: [{ type: "body", parameters: bodyParams.map((t) => ({ type: "text", text: t })) }] }
            : {}),
        },
        ...(contextWaMessageId ? { context: { message_id: contextWaMessageId } } : {}),
      }),
    }
  );
  if (!res.ok) return res;
  return { ok: true, waMessageId: res.data.messages?.[0]?.id ?? "" };
}

export type MediaKind = "image" | "document" | "audio" | "video" | "sticker";

/** Send a media message by provider MEDIA ID (uploaded via waUploadMedia or
 *  received from a webhook). Caption only applies to image/video/document. */
export async function waSendMedia(
  to: string,
  kind: MediaKind,
  mediaId: string,
  opts?: { caption?: string; filename?: string; contextWaMessageId?: string | null }
): Promise<SendResult> {
  const cfg = await getWhatsAppConfig();
  if (!cfg.connected) return { ok: false, error: "WhatsApp not connected — configure credentials in Integrations first." };
  const payload: Record<string, unknown> = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: kind,
  };
  payload[kind] = {
    id: mediaId,
    ...(opts?.caption && kind !== "audio" && kind !== "sticker" ? { caption: opts.caption } : {}),
    ...(opts?.filename && kind === "document" ? { filename: opts.filename } : {}),
  };
  if (opts?.contextWaMessageId) payload.context = { message_id: opts.contextWaMessageId };
  const res = await graph<{ messages?: { id: string }[] }>(
    `${cfg.phoneNumberId}/messages`,
    { method: "POST", token: cfg.accessToken, version: cfg.graphVersion, body: JSON.stringify(payload) }
  );
  if (!res.ok) return res;
  return { ok: true, waMessageId: res.data.messages?.[0]?.id ?? "" };
}

/** Upload media to Meta and get a provider MEDIA ID (server-side only).
 *  The browser never touches the access token. */
export async function waUploadMedia(
  file: Blob,
  filename: string,
  mimeType: string
): Promise<ProviderResult<{ id: string }>> {
  const cfg = await getWhatsAppConfig();
  if (!cfg.connected) return { ok: false, error: "WhatsApp not connected — configure credentials in Integrations first." };
  try {
    const form = new FormData();
    form.append("file", file, filename);
    form.append("messaging_product", "whatsapp");
    form.append("type", mimeType);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    const res = await fetch(`${GRAPH_BASE}/${cfg.graphVersion}/${cfg.phoneNumberId}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.accessToken}` },
      body: form,
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = (body as { error?: { message?: string; code?: number } }).error;
      return { ok: false, error: err?.message || `Graph media upload HTTP ${res.status}`, errorCode: err?.code, httpStatus: res.status };
    }
    if (!(body as { id?: string }).id) return { ok: false, error: "Meta accepted the upload but returned no media id." };
    return { ok: true, data: { id: (body as { id: string }).id } };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : "network error uploading media" };
  }
}

/** Get a short-lived signed CDN URL for a media id (real Graph response). */
export async function waGetMediaUrl(
  mediaId: string
): Promise<ProviderResult<{ url: string; mimeType: string; fileSize?: number; filename?: string }>> {
  const cfg = await getWhatsAppConfig();
  if (!cfg.connected) return { ok: false, error: "WhatsApp not connected — configure credentials in Integrations first." };
  const res = await graph<{ url?: string; mime_type?: string; file_size?: number; filename?: string }>(
    `${mediaId}`,
    { method: "GET", token: cfg.accessToken, version: cfg.graphVersion }
  );
  if (!res.ok) return res;
  if (!res.data.url) return { ok: false, error: "Meta returned no downloadable URL for this media id." };
  return {
    ok: true,
    data: { url: res.data.url, mimeType: res.data.mime_type || "application/octet-stream", fileSize: res.data.file_size, filename: res.data.filename },
  };
}

export async function waMarkRead(waMessageId: string): Promise<ProviderResult<unknown>> {
  const cfg = await getWhatsAppConfig();
  if (!cfg.connected) return { ok: false, error: "WhatsApp not connected." };
  return graph(`${cfg.phoneNumberId}/messages`, {
    method: "POST",
    token: cfg.accessToken,
    version: cfg.graphVersion,
    body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: waMessageId }),
  });
}

/** Verify credentials against the real Graph API (phone number node). */
export async function waVerifyCredentials(): Promise<ProviderResult<{ displayPhoneNumber?: string; verifiedName?: string }>> {
  const cfg = await getWhatsAppConfig();
  if (!cfg.phoneNumberId || !cfg.accessToken) {
    return { ok: false, error: "Phone Number ID and access token are required." };
  }
  return graph(`${cfg.phoneNumberId}`, {
    method: "GET",
    token: cfg.accessToken,
    version: cfg.graphVersion,
  });
}

/** Fetch template approval statuses straight from Meta (WABA templates). */
export async function waFetchTemplateStatuses(): Promise<ProviderResult<{ name: string; status: string; language: string }[]>> {
  const cfg = await getWhatsAppConfig();
  if (!cfg.wabaId || !cfg.accessToken) {
    return { ok: false, error: "WABA ID and access token are required." };
  }
  const res = await graph<{ data?: { name: string; status: string; language: string }[] }>(
    `${cfg.wabaId}/message_templates?limit=100`,
    { method: "GET", token: cfg.accessToken, version: cfg.graphVersion }
  );
  if (!res.ok) return res;
  return { ok: true, data: res.data.data ?? [] };
}

export type MetaTemplateFull = {
  name: string;
  status: string; // APPROVED | PENDING | REJECTED | PAUSED | DISABLED
  category: string; // MARKETING | UTILITY | AUTHENTICATION
  language: string;
  bodyText: string;
  variables: string[]; // {{n}} tokens in order of appearance
  metaTemplateId: string;
  updatedAt?: string;
  qualityScore?: string;
};

/** Fetch the FULL template objects (components included) so the CRM can
 *  mirror exactly what Meta approved — body text, category, variables. */
export async function waFetchTemplatesFull(): Promise<ProviderResult<MetaTemplateFull[]>> {
  const cfg = await getWhatsAppConfig();
  if (!cfg.wabaId || !cfg.accessToken) {
    return { ok: false, error: "WABA ID and access token are required." };
  }
  const res = await graph<{
    data?: {
      id: string;
      name: string;
      status: string;
      category: string;
      language: string;
      components?: { type: string; text?: string; example?: { body_text?: string[][] } }[];
      updated_at?: string;
    }[];
  }>(
    `${cfg.wabaId}/message_templates?limit=100&fields=id,name,status,category,language,components,updated_at`,
    { method: "GET", token: cfg.accessToken, version: cfg.graphVersion }
  );
  if (!res.ok) return res;
  const out: MetaTemplateFull[] = [];
  for (const t of res.data.data ?? []) {
    const bodyComp = (t.components ?? []).find((c) => c.type === "BODY");
    const bodyText = bodyComp?.text ?? "";
    const variables = [...bodyText.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((m) => m[1]);
    out.push({
      name: t.name,
      status: t.status,
      category: t.category,
      language: t.language,
      bodyText,
      variables,
      metaTemplateId: t.id,
      updatedAt: t.updated_at,
    });
  }
  return { ok: true, data: out };
}
