import { db } from "@/lib/db";
import { getAuthUser, can, jsonError } from "@/lib/lp/auth";
import { logAudit } from "@/lib/lp/activity";

export async function GET(req: Request) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "campaigns.read")) return jsonError("Unauthorized", 401);

  const campaigns = await db.campaign.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      template: { select: { id: true, name: true, approvalStatus: true } },
      sender: { select: { id: true, name: true } },
      _count: { select: { recipients: true } },
    },
  });

  // Real stats per campaign (spec §6) — computed from recipient rows, never faked
  const stats = await Promise.all(
    campaigns.map(async (c) => {
      const group = await db.campaignRecipient.groupBy({
        by: ["status"],
        where: { campaignId: c.id },
        _count: true,
      });
      const byStatus: Record<string, number> = {};
      for (const g of group) byStatus[g.status] = g._count;
      return {
        id: c.id,
        recipients: Object.values(byStatus).reduce((a, b) => a + b, 0),
        queued: byStatus.queued || 0,
        sent: byStatus.sent || 0,
        delivered: byStatus.delivered || 0,
        read: byStatus.read || 0,
        failed: byStatus.failed || 0,
        replies: byStatus.replied || 0,
        optOuts: byStatus.excluded_optout || 0,
      };
    })
  );

  return Response.json({ campaigns: campaigns.map((c, i) => ({ ...c, stats: stats[i] })) });
}

export async function POST(req: Request) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "campaigns.manage")) return jsonError("Unauthorized", 401);
  const body = await req.json().catch(() => ({}));
  if (!body.name) return jsonError("Campaign name is required.", 400);

  const campaign = await db.campaign.create({
    data: {
      name: String(body.name).slice(0, 160),
      audienceJson: body.audience ? JSON.stringify(body.audience) : null,
      templateId: body.templateId || null,
      bodyText: body.bodyText || null,
      senderId: body.senderId || user.id,
      scheduleAt: body.scheduleAt ? new Date(body.scheduleAt) : null,
      dailyLimit: Math.max(1, parseInt(body.dailyLimit, 10) || 200),
      minIntervalSec: Math.max(1, parseInt(body.minIntervalSec, 10) || 8),
      status: body.scheduleAt ? "scheduled" : "draft",
    },
  });
  await logAudit({ actorId: user.id, actorName: user.name, action: "campaign.create", entity: "campaign", entityId: campaign.id, detail: campaign.name });
  return Response.json({ campaign }, { status: 201 });
}
