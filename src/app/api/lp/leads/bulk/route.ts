import { db } from "@/lib/db";
import { getAuthUser, can, jsonError } from "@/lib/lp/auth";
import { logActivity, logAudit } from "@/lib/lp/activity";

// Bulk operations (spec §14): assign, tag, untag, status, archive, followup.
export async function POST(req: Request) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "leads.bulk")) return jsonError("Unauthorized", 401);
  const { action, ids, payload } = await req.json().catch(() => ({}));
  if (!Array.isArray(ids) || ids.length === 0) return jsonError("No leads selected.", 400);
  const leadIds = ids as string[];

  let affected = 0;
  switch (action) {
    case "assign": {
      if (!payload?.assignedToId) return jsonError("assignedToId required", 400);
      const assignee = await db.user.findUnique({ where: { id: payload.assignedToId } });
      if (!assignee) return jsonError("Assignee not found", 404);
      const r = await db.lead.updateMany({ where: { id: { in: leadIds } }, data: { assignedToId: payload.assignedToId } });
      affected = r.count;
      for (const id of leadIds) {
        await logActivity({ leadId: id, actorId: user.id, type: "assigned", title: `Assigned to ${assignee.name}.` });
      }
      await logAudit({ actorId: user.id, actorName: user.name, action: "lead.bulk_assign", detail: `${affected} leads → ${assignee.name}` });
      break;
    }
    case "addTag": {
      const tag = String(payload?.tag || "").trim();
      if (!tag) return jsonError("tag required", 400);
      const leads = await db.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, tags: true } });
      for (const l of leads) {
        const tags: string[] = JSON.parse(l.tags || "[]");
        if (!tags.includes(tag)) tags.push(tag);
        await db.lead.update({ where: { id: l.id }, data: { tags: JSON.stringify(tags) } });
        await logActivity({ leadId: l.id, actorId: user.id, type: "tag_added", title: `Tag added: ${tag}.` });
        affected++;
      }
      await logAudit({ actorId: user.id, actorName: user.name, action: "lead.bulk_tag", detail: `+${tag} on ${leads.length} leads` });
      break;
    }
    case "removeTag": {
      const tag = String(payload?.tag || "").trim();
      const leads = await db.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, tags: true } });
      for (const l of leads) {
        const tags: string[] = JSON.parse(l.tags || "[]");
        await db.lead.update({ where: { id: l.id }, data: { tags: JSON.stringify(tags.filter((t) => t !== tag)) } });
        affected++;
      }
      await logAudit({ actorId: user.id, actorName: user.name, action: "lead.bulk_untag", detail: `-${tag}` });
      break;
    }
    case "status": {
      if (!payload?.status) return jsonError("status required", 400);
      const r = await db.lead.updateMany({ where: { id: { in: leadIds } }, data: { status: payload.status } });
      affected = r.count;
      for (const id of leadIds) {
        await logActivity({ leadId: id, actorId: user.id, type: "status_changed", title: `Status changed → ${payload.status} (bulk).` });
      }
      await logAudit({ actorId: user.id, actorName: user.name, action: "lead.bulk_status", detail: `${affected} → ${payload.status}` });
      break;
    }
    case "archive": {
      const r = await db.lead.updateMany({ where: { id: { in: leadIds } }, data: { status: "archived" } });
      affected = r.count;
      await logAudit({ actorId: user.id, actorName: user.name, action: "lead.bulk_archive", detail: `${affected} leads` });
      break;
    }
    case "doNotContact": {
      const leads = await db.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, whatsappNorm: true, email: true } });
      for (const l of leads) {
        await db.lead.update({ where: { id: l.id }, data: { optedOut: true, optedOutAt: new Date(), status: "do_not_contact" } });
        const value = l.whatsappNorm || l.email || l.id;
        await db.optOut.upsert({
          where: { channel_value: { channel: l.whatsappNorm ? "whatsapp" : "email", value } },
          create: { channel: l.whatsappNorm ? "whatsapp" : "email", value, reason: "dnc_list", source: "manual", leadId: l.id },
          update: { optBackInAt: null },
        });
        await logActivity({ leadId: l.id, actorId: user.id, type: "opt_out", title: "Do Not Contact (bulk) — suppressed." });
        affected++;
      }
      await logAudit({ actorId: user.id, actorName: user.name, action: "lead.bulk_dnc", detail: `${affected} leads suppressed` });
      break;
    }
    case "scheduleFollowUp": {
      if (!payload?.dueAt) return jsonError("dueAt required", 400);
      const dueAt = new Date(payload.dueAt);
      const leads = await db.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, assignedToId: true } });
      for (const l of leads) {
        await db.followUp.create({
          data: { leadId: l.id, ownerId: payload.ownerId || l.assignedToId || user.id, dueAt, priority: payload.priority || "normal", notes: payload.notes },
        });
        await logActivity({ leadId: l.id, actorId: user.id, type: "followup_scheduled", title: `Follow-up scheduled for ${dueAt.toISOString().slice(0, 10)} (bulk).` });
        affected++;
      }
      await logAudit({ actorId: user.id, actorName: user.name, action: "lead.bulk_followup", detail: `${affected} scheduled` });
      break;
    }
    default:
      return jsonError(`Unknown bulk action "${action}"`, 400);
  }

  return Response.json({ ok: true, affected });
}
