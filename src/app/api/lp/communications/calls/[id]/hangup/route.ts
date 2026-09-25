import { getAuthUser, can, jsonError } from "@/lib/lp/auth";
import { db } from "@/lib/db";
import { getCallingAdapter } from "@/lib/lp/calling";
import { logAudit } from "@/lib/lp/activity";

export const runtime = "nodejs";

// POST /api/lp/communications/calls/[id]/hangup  { }
//
// Ends a REAL provider-backed call through the calling adapter (Twilio
// Status=completed). The CRM Call row is finalized with a server-measured
// interval; the provider's own status webhook later corrects durationSec
// with the authoritative value. With no provider call attached the route
// refuses honestly — nothing is fabricated.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "calls.write")) return jsonError("Unauthorized", 401);
  const { id } = await ctx.params;

  const call = await db.call.findUnique({ where: { id } });
  if (!call) return jsonError("Call not found", 404);
  if (call.status === "completed") {
    return Response.json({ ok: true, status: "completed", note: "Call already ended." });
  }
  if (!call.providerCallId) {
    return Response.json(
      { error: "This call has no provider call attached — nothing to hang up.", reason: "no_provider_call" },
      { status: 409 }
    );
  }

  const adapter = await getCallingAdapter();
  const res = await adapter.hangup(call.providerCallId);
  if (!res.ok) {
    // 424 so Cloudflare passes the provider's real error through (5xx bodies get replaced).
    return Response.json({ error: res.error, reason: "provider_error" }, { status: 424 });
  }

  // Server-measured real interval (provider webhook will overwrite with the
  // authoritative CallDuration when its completed event arrives).
  const endedAt = new Date();
  const durationSec = call.startedAt ? Math.max(0, Math.round((endedAt.getTime() - call.startedAt.getTime()) / 1000)) : null;
  await db.call.update({
    where: { id: call.id },
    data: { status: "completed", endedAt, ...(durationSec !== null ? { durationSec } : {}) },
  });
  await logAudit({ actorId: user.id, actorName: user.name, action: "call.hangup", entity: "call", entityId: call.id, detail: `provider=${adapter.id} durationSec=${durationSec ?? "?"}` });
  return Response.json({ ok: true, status: "completed", durationSec });
}
