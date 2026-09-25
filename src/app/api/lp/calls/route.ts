import { db } from "@/lib/db";
import { getAuthUser, can, jsonError } from "@/lib/lp/auth";
import { logActivity, logAudit } from "@/lib/lp/activity";

const STATUSES = ["completed", "missed", "busy", "no_answer", "failed", "scheduled"];
const OUTCOMES = ["interested", "not_interested", "callback_requested", "qualified", "converted", "wrong_number", "do_not_contact", "pending"];

export async function GET(req: Request) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "leads.read")) return jsonError("Unauthorized", 401);
  const url = new URL(req.url);
  const mine = url.searchParams.get("mine") === "1";
  const calls = await db.call.findMany({
    where: mine ? { employeeId: user.id } : {},
    orderBy: { createdAt: "desc" },
    take: 300,
    include: {
      lead: { select: { id: true, firstName: true, lastName: true, company: true, phone: true, whatsapp: true, country: true } },
      employee: { select: { id: true, name: true } },
    },
  });
  return Response.json({ calls });
}

// POST — LOG a call activity. Honesty rules (spec §9/§25):
//  - durationSec only if the employee actually provides it (real value)
//  - recordingUrl only if a real provider supplied one (there is none yet)
//  - method records HOW the call was really placed (device dialer / whatsapp / provider)
export async function POST(req: Request) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "calls.write")) return jsonError("Unauthorized", 401);
  const body = await req.json().catch(() => ({}));
  if (!body.leadId) return jsonError("leadId required", 400);
  if (!STATUSES.includes(body.status)) return jsonError(`status must be one of: ${STATUSES.join(", ")}`, 400);
  if (body.outcome && !OUTCOMES.includes(body.outcome)) return jsonError(`outcome must be one of: ${OUTCOMES.join(", ")}`, 400);
  if (body.status === "completed" && (body.durationSec == null || Number(body.durationSec) <= 0)) {
    return jsonError("A COMPLETED call requires the real duration in seconds (never fabricated).", 400);
  }

  const call = await db.call.create({
    data: {
      leadId: body.leadId,
      employeeId: user.id,
      direction: body.direction || "outbound",
      method: body.method || "device_dialer", // device_dialer | whatsapp_open | provider
      provider: body.provider || null, // null until a real telephony provider is connected
      status: body.status,
      outcome: body.outcome || (body.status === "completed" ? "pending" : null),
      durationSec: body.durationSec != null && Number(body.durationSec) > 0 ? Math.round(Number(body.durationSec)) : null,
      recordingUrl: body.recordingUrl || null,
      notes: body.notes || null,
      scheduledFor: body.scheduledFor ? new Date(body.scheduledFor) : null,
      startedAt: body.startedAt ? new Date(body.startedAt) : body.status === "completed" ? new Date() : null,
      endedAt: body.endedAt ? new Date(body.endedAt) : null,
    },
  });

  await db.lead.update({ where: { id: body.leadId }, data: { lastContactAt: new Date() } });
  const dur = call.durationSec != null ? ` (${Math.floor(call.durationSec / 60)}m ${call.durationSec % 60}s)` : "";
  await logActivity({
    leadId: body.leadId,
    actorId: user.id,
    type: "call_logged",
    title: `Call ${call.status}${dur} via ${call.method === "device_dialer" ? "device dialer" : call.method === "whatsapp_open" ? "WhatsApp" : call.method}.${call.outcome && call.outcome !== "pending" ? ` Outcome: ${call.outcome.replace(/_/g, " ")}.` : ""}`,
    meta: { callId: call.id },
  });
  await logAudit({ actorId: user.id, actorName: user.name, action: "call.log", entity: "lead", entityId: body.leadId, detail: `${call.status}${dur}` });

  // converted outcome updates the lead
  if (body.outcome === "converted") {
    await db.lead.update({ where: { id: body.leadId }, data: { status: "converted" } });
    await logActivity({ leadId: body.leadId, actorId: user.id, type: "converted", title: "Lead CONVERTED 🎉" });
  }

  return Response.json({ call }, { status: 201 });
}
