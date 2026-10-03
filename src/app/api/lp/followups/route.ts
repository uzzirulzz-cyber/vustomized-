import { db } from "@/lib/db";
import { getAuthUser, can, jsonError } from "@/lib/lp/auth";
import { logActivity, logAudit } from "@/lib/lp/activity";

export async function GET(req: Request) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "leads.read")) return jsonError("Unauthorized", 401);
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") || "all"; // all | today | overdue | upcoming | mine
  const now = new Date();
  const endOfToday = new Date(now); endOfToday.setHours(23, 59, 59, 999);
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);

  const where: Record<string, unknown> = { status: "pending" };
  if (scope === "mine") where.ownerId = user.id;
  if (scope === "today") { where.dueAt = { gte: startOfToday, lte: endOfToday }; if (scope === "mine") where.ownerId = user.id; }
  if (scope === "overdue") where.dueAt = { lt: startOfToday };
  if (scope === "upcoming") where.dueAt = { gt: endOfToday };
  if (scope === "mine") { where.status = "pending"; }

  const followups = await db.followUp.findMany({
    where,
    orderBy: { dueAt: "asc" },
    take: 300,
    include: {
      lead: { select: { id: true, firstName: true, lastName: true, company: true, whatsapp: true, phone: true, email: true, country: true } },
      owner: { select: { id: true, name: true } },
    },
  });
  return Response.json({ followups });
}

export async function POST(req: Request) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "followups.write")) return jsonError("Unauthorized", 401);
  const body = await req.json().catch(() => ({}));
  if (!body.leadId || !body.dueAt) return jsonError("leadId and dueAt are required.", 400);

  const followup = await db.followUp.create({
    data: {
      leadId: body.leadId,
      ownerId: body.ownerId || user.id,
      dueAt: new Date(body.dueAt),
      priority: body.priority || "normal",
      notes: body.notes || null,
    },
  });
  const when = new Date(body.dueAt).toISOString().slice(0, 16).replace("T", " ");
  await logActivity({ leadId: body.leadId, actorId: user.id, type: "followup_scheduled", title: `Follow-up scheduled for ${when}.`, meta: { followupId: followup.id } });
  await logAudit({ actorId: user.id, actorName: user.name, action: "followup.create", entity: "lead", entityId: body.leadId });
  return Response.json({ followup }, { status: 201 });
}
