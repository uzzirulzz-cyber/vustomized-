import { getAuthUser, can, jsonError } from "@/lib/lp/auth";
import { db } from "@/lib/db";
import { logActivity, logAudit } from "@/lib/lp/activity";

export const runtime = "nodejs";

const OUTCOMES = [
  "interested", "follow_up", "qualified", "not_interested", "no_answer",
  "busy", "wrong_number", "converted", "other",
];

// POST /api/lp/communications/calls/:id/note
// { outcome?, notes?, followUpAt? } — post-call disposition (spec §11).
// Saved against BOTH the call record and the associated CRM lead timeline.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "calls.write")) return jsonError("Unauthorized", 401);
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const call = await db.call.findUnique({ where: { id } });
  if (!call) return jsonError("Call not found", 404);

  const outcome = body.outcome ? String(body.outcome) : null;
  if (outcome && !OUTCOMES.includes(outcome)) {
    return jsonError(`outcome must be one of: ${OUTCOMES.join(", ")}`, 400);
  }
  const notes = body.notes != null ? String(body.notes).slice(0, 4000) : null;
  const followUpAt = body.followUpAt ? new Date(body.followUpAt) : null;
  if (body.followUpAt && (isNaN(followUpAt!.getTime()))) return jsonError("followUpAt is not a valid date.", 400);

  const updated = await db.call.update({
    where: { id },
    data: {
      outcome: outcome ?? call.outcome,
      notes: notes ?? call.notes,
      // a scheduled disposition converts "missed/no_answer" records into scheduled follow-ups
      ...(outcome === "no_answer" || outcome === "busy" ? { status: call.status === "completed" ? call.status : "scheduled" } : {}),
    },
  });

  const fragments: string[] = [];
  if (outcome) fragments.push(`Outcome: ${outcome.replace(/_/g, " ")}`);
  if (notes) fragments.push(`Notes: ${notes.slice(0, 80)}${notes.length > 80 ? "…" : ""}`);
  if (followUpAt) fragments.push(`Follow-up scheduled ${followUpAt.toISOString().slice(0, 16).replace("T", " ")}`);
  await logActivity({
    leadId: call.leadId,
    actorId: user.id,
    type: followUpAt ? "followup_scheduled" : "call_logged",
    title: `Call disposition saved — ${fragments.join(" · ") || "no changes"}`,
    meta: { callId: call.id },
  });
  await logAudit({ actorId: user.id, actorName: user.name, action: "call.note", entity: "call", entityId: call.id, detail: fragments.join(" · ") });

  // Follow-up record so it lands in the Follow-ups workspace too
  let followUpId: string | null = null;
  if (followUpAt) {
    const fu = await db.followUp.create({
      data: { leadId: call.leadId, ownerId: user.id, dueAt: followUpAt, notes: notes || `Follow-up from call ${call.id}`, priority: outcome === "interested" || outcome === "qualified" ? "high" : "normal" },
    });
    followUpId = fu.id;
  }

  if (outcome === "converted") {
    await db.lead.update({ where: { id: call.leadId }, data: { status: "converted" } });
    await logActivity({ leadId: call.leadId, actorId: user.id, type: "converted", title: "Lead CONVERTED via call outcome." });
  }

  return Response.json({ ok: true, call: updated, followUpId });
}
