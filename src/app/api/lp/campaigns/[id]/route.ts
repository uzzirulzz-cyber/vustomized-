import { db } from "@/lib/db";
import { getAuthUser, can, jsonError } from "@/lib/lp/auth";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "campaigns.read")) return jsonError("Unauthorized", 401);
  const { id } = await params;

  const campaign = await db.campaign.findUnique({
    where: { id },
    include: {
      template: true,
      sender: { select: { id: true, name: true } },
    },
  });
  if (!campaign) return jsonError("Campaign not found", 404);

  const recipients = await db.campaignRecipient.findMany({
    where: { campaignId: id },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    take: 1000,
    include: { lead: { select: { id: true, firstName: true, lastName: true, company: true, whatsapp: true, country: true } } },
  });

  return Response.json({ campaign, recipients });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "campaigns.manage")) return jsonError("Unauthorized", 401);
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if ("name" in body) data.name = String(body.name).slice(0, 160);
  if ("templateId" in body) data.templateId = body.templateId || null;
  if ("bodyText" in body) data.bodyText = body.bodyText || null;
  if ("scheduleAt" in body) data.scheduleAt = body.scheduleAt ? new Date(body.scheduleAt) : null;
  if ("dailyLimit" in body) data.dailyLimit = Math.max(1, parseInt(body.dailyLimit, 10) || 200);
  if ("minIntervalSec" in body) data.minIntervalSec = Math.max(1, parseInt(body.minIntervalSec, 10) || 8);
  if ("audience" in body) data.audienceJson = JSON.stringify(body.audience);
  const campaign = await db.campaign.update({ where: { id }, data });
  return Response.json({ campaign });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "campaigns.manage")) return jsonError("Unauthorized", 401);
  const { id } = await params;
  const campaign = await db.campaign.findUnique({ where: { id } });
  if (campaign?.status === "running") return jsonError("Pause or cancel the campaign before deleting it.", 409);
  await db.campaign.delete({ where: { id } });
  return Response.json({ ok: true });
}
