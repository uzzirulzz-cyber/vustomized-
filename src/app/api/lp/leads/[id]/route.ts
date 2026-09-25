import { db } from "@/lib/db";
import { getAuthUser, can, jsonError } from "@/lib/lp/auth";
import { logActivity, logAudit } from "@/lib/lp/activity";
import { normalizePhone } from "@/lib/lp/csv";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "leads.read")) return jsonError("Unauthorized", 401);
  const { id } = await params;

  const lead = await db.lead.findUnique({
    where: { id },
    include: { assignedTo: { select: { id: true, name: true, email: true } } },
  });
  if (!lead) return jsonError("Lead not found", 404);

  const [activities, notes, conversations, calls, followups, campaignHistory] = await Promise.all([
    db.activity.findMany({ where: { leadId: id }, orderBy: { createdAt: "desc" }, take: 200, include: { actor: { select: { name: true } } } }),
    db.leadNote.findMany({ where: { leadId: id }, orderBy: { createdAt: "desc" }, include: { author: { select: { name: true } } } }),
    db.conversation.findMany({ where: { leadId: id }, orderBy: { lastMessageAt: "desc" } }),
    db.call.findMany({ where: { leadId: id }, orderBy: { createdAt: "desc" } }),
    db.followUp.findMany({ where: { leadId: id }, orderBy: { dueAt: "asc" } }),
    db.campaignRecipient.findMany({
      where: { leadId: id },
      include: { campaign: { select: { id: true, name: true, status: true } } },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  return Response.json({ lead, activities, notes, conversations, calls, followups, campaignHistory });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "leads.write")) return jsonError("Unauthorized", 401);
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const existing = await db.lead.findUnique({ where: { id } });
  if (!existing) return jsonError("Lead not found", 404);

  const data: Record<string, unknown> = {};
  const stringFields = ["firstName", "lastName", "company", "jobTitle", "country", "state", "city", "address", "website", "industry"];
  for (const f of stringFields) if (f in body) data[f] = body[f] || null;
  if ("email" in body) {
    data.email = body.email ? String(body.email).toLowerCase().trim() : null;
    if (data.email) data.emailStatus = "valid";
  }
  if ("whatsapp" in body && body.whatsapp !== existing.whatsapp) {
    const wa = normalizePhone(body.whatsapp || "");
    data.whatsapp = wa.e164;
    data.whatsappNorm = wa.e164?.replace(/\D/g, "") ?? null;
  }
  if ("phone" in body) {
    const ph = normalizePhone(body.phone || "");
    data.phone = ph.e164;
    data.phoneNorm = ph.e164?.replace(/\D/g, "") ?? null;
  }
  if ("status" in body && body.status && body.status !== existing.status) {
    data.status = body.status;
  }
  if ("score" in body) data.score = Math.max(0, Math.min(100, parseInt(body.score, 10) || 0));
  if ("tags" in body && Array.isArray(body.tags)) data.tags = JSON.stringify(body.tags);
  if ("assignedToId" in body) data.assignedToId = body.assignedToId || null;
  if ("optedOut" in body) {
    data.optedOut = Boolean(body.optedOut);
    data.optedOutAt = body.optedOut ? new Date() : null;
  }

  const lead = await db.lead.update({ where: { id }, data });

  // Timeline entries for the meaningful changes
  if (data.status && data.status !== existing.status) {
    await logActivity({ leadId: id, actorId: user.id, type: "status_changed", title: `Status changed: ${existing.status} → ${data.status}.` });
    await logAudit({ actorId: user.id, actorName: user.name, action: "lead.status", entity: "lead", entityId: id, detail: `${existing.status} → ${data.status}` });
  }
  if ("assignedToId" in data && data.assignedToId !== existing.assignedToId) {
    const assignee = data.assignedToId ? await db.user.findUnique({ where: { id: data.assignedToId as string } }) : null;
    await logActivity({
      leadId: id, actorId: user.id, type: "assigned",
      title: assignee ? `Assigned to ${assignee.name}.` : "Unassigned.",
    });
    await logAudit({ actorId: user.id, actorName: user.name, action: "lead.assign", entity: "lead", entityId: id, detail: assignee?.name || "unassigned" });
  }
  if ("optedOut" in data && data.optedOut && !existing.optedOut) {
    await db.optOut.upsert({
      where: { channel_value: { channel: "whatsapp", value: lead.whatsappNorm || lead.email || id } },
      create: { channel: lead.whatsappNorm ? "whatsapp" : "email", value: lead.whatsappNorm || lead.email || id, reason: "manual", source: "manual", leadId: id },
      update: { optBackInAt: null },
    });
    await logActivity({ leadId: id, actorId: user.id, type: "opt_out", title: "Marked Do Not Contact — added to suppression list." });
  }

  return Response.json({ lead });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "leads.delete")) return jsonError("Unauthorized", 401);
  const { id } = await params;
  await db.lead.update({ where: { id }, data: { status: "archived" } });
  await logAudit({ actorId: user.id, actorName: user.name, action: "lead.archive", entity: "lead", entityId: id });
  return Response.json({ ok: true });
}
