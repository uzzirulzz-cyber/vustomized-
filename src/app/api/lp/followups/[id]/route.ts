import { db } from "@/lib/db";
import { getAuthUser, can, jsonError } from "@/lib/lp/auth";
import { logActivity } from "@/lib/lp/activity";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "followups.write")) return jsonError("Unauthorized", 401);
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const followup = await db.followUp.findUnique({ where: { id } });
  if (!followup) return jsonError("Follow-up not found", 404);

  if (body.action === "complete") {
    const updated = await db.followUp.update({
      where: { id },
      data: { status: "completed", completedAt: new Date(), outcome: body.outcome || "done" },
    });
    await logActivity({ leadId: followup.leadId, actorId: user.id, type: "followup_completed", title: `Follow-up completed${body.outcome ? ` (${body.outcome})` : ""}.` });
    return Response.json({ followup: updated });
  }
  if (body.action === "reschedule") {
    if (!body.dueAt) return jsonError("dueAt required to reschedule", 400);
    const dueAt = new Date(body.dueAt);
    const updated = await db.followUp.update({ where: { id }, data: { dueAt, status: "pending" } });
    await logActivity({ leadId: followup.leadId, actorId: user.id, type: "followup_scheduled", title: `Follow-up rescheduled to ${dueAt.toISOString().slice(0, 16).replace("T", " ")}.` });
    return Response.json({ followup: updated });
  }
  if (body.action === "cancel") {
    const updated = await db.followUp.update({ where: { id }, data: { status: "cancelled" } });
    return Response.json({ followup: updated });
  }
  return jsonError("Unknown action", 400);
}
