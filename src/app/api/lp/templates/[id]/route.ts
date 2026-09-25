import { db } from "@/lib/db";
import { getAuthUser, can, jsonError } from "@/lib/lp/auth";
import { detectVariables } from "@/lib/lp/render";
import { logAudit } from "@/lib/lp/activity";
import { waFetchTemplateStatuses } from "@/lib/lp/whatsapp";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "templates.manage")) return jsonError("Unauthorized", 401);
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const data: Record<string, unknown> = {};
  if ("name" in body) data.name = String(body.name).slice(0, 120);
  if ("category" in body) data.category = body.category;
  if ("language" in body) data.language = body.language;
  if ("bodyText" in body) {
    data.bodyText = String(body.bodyText);
    data.variables = JSON.stringify(detectVariables(String(body.bodyText)));
  }
  if ("archived" in body) data.archived = Boolean(body.archived);

  // Approval actions (admin-only) — including a REAL sync against Meta
  if ("approvalStatus" in body) {
    if (!can(user.role, "templates.approve")) return jsonError("Only admins can change approval status.", 403);
    if (body.approvalStatus === "meta_approved" || body.approvalStatus === "meta_rejected") {
      data.approvalStatus = body.approvalStatus;
    } else if (body.approvalStatus === "sync_meta") {
      // pull REAL statuses from Meta WABA and match by name+language
      const result = await waFetchTemplateStatuses();
      if (!result.ok) return jsonError(`Meta template sync failed: ${result.error}`, 502);
      const template = await db.template.findUnique({ where: { id } });
      if (!template) return jsonError("Template not found", 404);
      const match = result.data.find((t) => t.name === template.name && t.language === template.language);
      data.approvalStatus = match ? `meta_${match.status.toLowerCase()}` : "meta_pending";
      if (match) data.metaTemplateId = match.name;
    }
  }

  const template = await db.template.update({ where: { id }, data });
  await logAudit({ actorId: user.id, actorName: user.name, action: "template.update", entity: "template", entityId: id, detail: JSON.stringify(Object.keys(data)) });
  return Response.json({ template });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "templates.manage")) return jsonError("Unauthorized", 401);
  const { id } = await params;
  await db.template.update({ where: { id }, data: { archived: true } });
  await logAudit({ actorId: user.id, actorName: user.name, action: "template.archive", entity: "template", entityId: id });
  return Response.json({ ok: true });
}
