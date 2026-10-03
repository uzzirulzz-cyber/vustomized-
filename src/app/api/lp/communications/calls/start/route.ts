import { getAuthUser, can, jsonError } from "@/lib/lp/auth";
import { db } from "@/lib/db";
import { getCallingAdapter } from "@/lib/lp/calling";
import { normalizePhone } from "@/lib/lp/csv";
import { logActivity, logAudit } from "@/lib/lp/activity";

export const runtime = "nodejs";

// POST /api/lp/communications/calls/start  { leadId? , phone?, name? }
//
// Attempts a REAL provider-backed outbound call through the calling adapter.
// With no telephony provider configured (current state) the adapter refuses
// and this route returns 409 NOT CONFIGURED — the UI renders the honest
// state. No call record is fabricated for a call that never happened.
export async function POST(req: Request) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "calls.write")) return jsonError("Unauthorized", 401);
  const body = await req.json().catch(() => ({}));

  let lead: { id: string; phone: string | null; whatsapp: string | null } | null = null;
  let to: string | null = null;
  if (body.leadId) {
    const found = await db.lead.findUnique({ where: { id: body.leadId }, select: { id: true, phone: true, whatsapp: true } });
    if (!found) return jsonError("Lead not found", 404);
    lead = found;
    to = lead.phone || lead.whatsapp || null;
  } else if (body.phone) {
    const norm = normalizePhone(String(body.phone));
    to = norm.e164 || String(body.phone);
    const normDigits = to.replace(/\D/g, "");
    lead =
      (await db.lead.findFirst({ where: { phoneNorm: normDigits } })) ||
      (await db.lead.findFirst({ where: { whatsappNorm: normDigits } })) ||
      null;
  }
  if (!to) return jsonError("No phone number available for this contact.", 400);

  const adapter = await getCallingAdapter();
  const result = await adapter.startCall(user.id, to);

  if (!result.ok) {
    const reason = result.errorCode === "calling_not_configured"
      ? "not_configured"
      : result.errorCode === "calling_capability_unavailable"
        ? "capability_unavailable"
        : "provider_error";
    // 424 (Failed Dependency) — Cloudflare in front of this domain replaces
    // origin 5xx bodies with its own error page, which would swallow the
    // provider's real error message. 4xx passes through with the body intact.
    return Response.json(
      { error: result.error, reason, to },
      { status: result.errorCode === "calling_not_configured" ? 409 : 424 }
    );
  }

  // Provider accepted the call — record it honestly (method=provider).
  let leadId = lead?.id;
  if (!leadId) {
    const created = await db.lead.create({
      data: {
        firstName: body.name ? String(body.name).split(" ")[0] : null,
        lastName: body.name ? String(body.name).split(" ").slice(1).join(" ") : null,
        phone: to,
        phoneNorm: to.replace(/\D/g, ""),
        source: "manual",
        status: "new",
      },
    });
    leadId = created.id;
  }
  const call = await db.call.create({
    data: {
      leadId,
      employeeId: user.id,
      direction: "outbound",
      method: "provider",
      provider: adapter.id,
      providerCallId: result.data.callId, // real provider sid — Twilio accepted the call
      status: "ringing", // provider event stream (webhook) moves it: in_progress → completed/no_answer/…
      startedAt: new Date(),
    },
  });
  await logActivity({ leadId, actorId: user.id, type: "call_logged", title: `Outbound call placed via ${adapter.label}.` });
  await logAudit({ actorId: user.id, actorName: user.name, action: "call.start", entity: "call", entityId: call.id, detail: `to ${to}` });

  return Response.json({ ok: true, callId: call.id, providerCallId: result.data.callId }, { status: 201 });
}
