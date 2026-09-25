import { db } from "@/lib/db";
import { getAuthUser, can, jsonError } from "@/lib/lp/auth";
import { logActivity, logAudit } from "@/lib/lp/activity";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "conversations.read")) return jsonError("Unauthorized", 401);
  const { id } = await params;

  const conversation = await db.conversation.findUnique({
    where: { id },
    include: {
      lead: { include: { assignedTo: { select: { id: true, name: true } } } },
      assignedTo: { select: { id: true, name: true } },
    },
  });
  if (!conversation) return jsonError("Conversation not found", 404);

  const messages = await db.message.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: "asc" },
    take: 500,
    include: { sender: { select: { id: true, name: true } } },
  });

  // Real provider state — surfaced honestly to the UI
  const integration = await db.integration.findUnique({ where: { provider: "whatsapp" } });
  const waConnected = Boolean(integration?.connected);

  return Response.json({ conversation, messages, waConnected });
}

// PATCH — team routing (spec §15): assign/reassign, open/pending/resolved,
// priority, tags. Employees may self-assign; reassigning to someone else and
// priority/tags are manager+.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "conversations.send")) return jsonError("Unauthorized", 401);
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const conversation = await db.conversation.findUnique({ where: { id }, include: { lead: { select: { id: true, firstName: true, lastName: true } } } });
  if (!conversation) return jsonError("Conversation not found", 404);

  const data: Record<string, unknown> = {};
  const notes: string[] = [];

  if ("assignedToId" in body) {
    const target = body.assignedToId ? String(body.assignedToId) : null;
    if (target && target !== user.id && !can(user.role, "leads.assign")) {
      return jsonError("Only managers and admins can reassign to another agent.", 403);
    }
    if (target) {
      const assignee = await db.user.findUnique({ where: { id: target } });
      if (!assignee) return jsonError("Assignee not found", 404);
    }
    data.assignedToId = target;
    notes.push(target ? `assigned to ${body.assignedName || target}` : "unassigned");
    if (conversation.leadId && target) {
      await db.lead.update({ where: { id: conversation.leadId }, data: { assignedToId: target } }).catch(() => { /* lead may be gone */ });
    }
  }
  if ("status" in body) {
    const status = String(body.status);
    if (!["open", "pending", "resolved", "closed"].includes(status)) return jsonError("status must be open | pending | resolved | closed", 400);
    data.status = status;
    notes.push(`status → ${status}`);
  }
  if ("priority" in body) {
    const priority = String(body.priority);
    if (!["low", "normal", "high", "urgent"].includes(priority)) return jsonError("priority must be low | normal | high | urgent", 400);
    if (priority !== "normal" && !can(user.role, "leads.assign")) return jsonError("Only managers and admins can change priority.", 403);
    data.priority = priority;
    notes.push(`priority → ${priority}`);
  }
  if ("tags" in body) {
    if (Array.isArray(body.tags)) {
      data.tags = JSON.stringify(body.tags.slice(0, 12).map((t: unknown) => String(t).slice(0, 40)));
      notes.push(`tags: ${(data.tags as string).length} set`);
    }
  }
  if (Object.keys(data).length === 0) return jsonError("Nothing to update.", 400);

  const updated = await db.conversation.update({ where: { id }, data });

  await logActivity({
    leadId: conversation.leadId,
    actorId: user.id,
    type: "assigned",
    title: `Conversation updated — ${notes.join(" · ")}`,
    meta: { conversationId: id },
  });
  await logAudit({ actorId: user.id, actorName: user.name, action: "conversation.update", entity: "conversation", entityId: id, detail: notes.join(" · ") });

  return Response.json({ ok: true, conversation: updated });
}
