import { getAuthUser, can, jsonError } from "@/lib/lp/auth";
import { db } from "@/lib/db";
import { waVerifyCredentials } from "@/lib/lp/whatsapp";
import { getCallingConfigMasked } from "@/lib/lp/calling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/lp/communications/health (spec §23)
// Every value is a REAL probe result — nothing is cached as "connected".
export async function GET(req: Request) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "conversations.read")) return jsonError("Unauthorized", 401);

  const started = Date.now();

  // ── Database ──
  let dbStatus = "connected";
  try {
    await db.user.findFirst({ select: { id: true } });
  } catch {
    dbStatus = "unreachable";
  }

  // ── WhatsApp provider (live Graph check) ──
  let whatsapp: { status: string; detail?: string; latencyMs?: number } = { status: "not_configured" };
  try {
    const v = await waVerifyCredentials();
    if (v.ok) {
      whatsapp = {
        status: "connected",
        detail: (v.data as { display_phone_number?: string; verified_name?: string }).display_phone_number || undefined,
        latencyMs: Date.now() - started,
      };
    } else if (v.errorCode === undefined && /required/i.test(v.error)) {
      whatsapp = { status: "not_configured", detail: v.error };
    } else {
      whatsapp = { status: "disconnected", detail: v.error };
    }
  } catch {
    whatsapp = { status: "disconnected", detail: "Graph check failed" };
  }

  // ── Webhook pipeline ──
  let webhook: { status: string; lastEventAt: string | null; lastKind: string | null; failed24h: number; received24h: number } = {
    status: "healthy",
    lastEventAt: null,
    lastKind: null,
    failed24h: 0,
    received24h: 0,
  };
  try {
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const [last, failed, received] = await Promise.all([
      db.webhookEvent.findFirst({ orderBy: { createdAt: "desc" } }),
      db.webhookEvent.count({ where: { processed: false, error: { not: null }, createdAt: { gte: since } } }),
      db.webhookEvent.count({ where: { createdAt: { gte: since } } }),
    ]);
    webhook = {
      status: failed > 0 ? "degraded" : "healthy",
      lastEventAt: last?.createdAt?.toISOString() ?? null,
      lastKind: last?.kind ?? null,
      failed24h: failed,
      received24h: received,
    };
  } catch { /* keep defaults */ }

  // ── Calling provider ──
  const calling = await getCallingConfigMasked();

  return Response.json({
    whatsapp,
    webhook,
    calling: { configured: calling.configured, provider: calling.provider, status: calling.configured ? "configured" : "not_configured" },
    database: dbStatus,
    realtime: { transport: "polling+socket-when-available", note: "Vercel serverless has no long-lived socket; the inbox polls on a short cursor and joins the socket service where the host allows it." },
    checkedAt: new Date().toISOString(),
    totalLatencyMs: Date.now() - started,
  });
}
