// Lead Pulse — activity timeline + audit + socket broadcast helpers.
import { db } from "@/lib/db";
import { emitToSocket } from "./socket";

/** Append a permanent timeline entry for a lead (spec §12) and broadcast it. */
export async function logActivity(input: {
  leadId: string;
  actorId?: string | null;
  type: string;
  title: string;
  detail?: string;
  meta?: Record<string, unknown>;
}) {
  const activity = await db.activity.create({
    data: {
      leadId: input.leadId,
      actorId: input.actorId ?? null,
      type: input.type,
      title: input.title,
      detail: input.detail,
      meta: input.meta ? JSON.stringify(input.meta) : undefined,
    },
    include: { actor: { select: { name: true } } },
  });
  emitToSocket("activity", {
    id: activity.id,
    leadId: activity.leadId,
    type: activity.type,
    title: activity.title,
    actorName: activity.actor?.name ?? "System",
    createdAt: activity.createdAt,
  });
  return activity;
}

export async function logAudit(input: {
  actorId?: string | null;
  actorName?: string;
  action: string;
  entity?: string;
  entityId?: string;
  detail?: string;
}) {
  await db.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      actorName: input.actorName,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      detail: input.detail,
    },
  });
}
