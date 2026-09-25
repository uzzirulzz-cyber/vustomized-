import { db } from "@/lib/db";
import { getAuthUser, jsonError } from "@/lib/lp/auth";

// Dashboard KPIs + activity feed — 100% computed from the database (spec §1/§20:
// no fabricated statistics).
export async function GET(req: Request) {
  const user = await getAuthUser(req);
  if (!user) return jsonError("Unauthorized", 401);

  const now = new Date();
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);

  const [
    totalLeads, newLeads, assignedLeads, contactedLeads, convertedLeads,
    conversations, callsToday, messagesSent, messagesDelivered, replies,
    followupsDue, overdueFollowups, optOuts,
  ] = await Promise.all([
    db.lead.count({ where: { status: { not: "archived" } } }),
    db.lead.count({ where: { status: "new" } }),
    db.lead.count({ where: { assignedToId: { not: null }, status: { not: "archived" } } }),
    db.lead.count({ where: { status: { in: ["contacted", "qualified", "converted"] } } }),
    db.lead.count({ where: { status: "converted" } }),
    db.conversation.count({ where: { status: "open" } }),
    db.call.count({ where: { createdAt: { gte: startOfToday } } }),
    db.message.count({ where: { direction: "outbound", status: { in: ["sent", "delivered", "read", "replied"] } } }),
    db.message.count({ where: { direction: "outbound", status: { in: ["delivered", "read"] } } }),
    db.message.count({ where: { direction: "inbound" } }),
    db.followUp.count({ where: { status: "pending", dueAt: { lte: new Date(now.getTime() + 24 * 3600 * 1000) } } }),
    db.followUp.count({ where: { status: "pending", dueAt: { lt: startOfToday } } }),
    db.optOut.count({ where: { optBackInAt: null } }),
  ]);

  const [recentActivities, runningCampaigns, topEmployees] = await Promise.all([
    db.activity.findMany({
      orderBy: { createdAt: "desc" },
      take: 12,
      include: { actor: { select: { name: true } }, lead: { select: { firstName: true, lastName: true, company: true } } },
    }),
    db.campaign.findMany({
      where: { status: { in: ["running", "scheduled", "paused", "completed"] } },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { _count: { select: { recipients: true } } },
    }),
    db.user.findMany({
      where: { role: { in: ["employee", "manager", "admin", "super_admin"] } },
      take: 6,
      select: { id: true, name: true, department: true },
    }),
  ]);

  const employeeActivity = await Promise.all(
    topEmployees.map(async (e) => {
      const [msgs, cls, flw] = await Promise.all([
        db.message.count({ where: { senderId: e.id, direction: "outbound" } }),
        db.call.count({ where: { employeeId: e.id } }),
        db.followUp.count({ where: { ownerId: e.id, status: "completed" } }),
      ]);
      return { ...e, messages: msgs, calls: cls, followupsCompleted: flw };
    })
  );

  const campaignStats = await Promise.all(
    runningCampaigns.map(async (c) => {
      const group = await db.campaignRecipient.groupBy({ by: ["status"], where: { campaignId: c.id }, _count: true });
      const by: Record<string, number> = {};
      for (const g of group) by[g.status] = g._count;
      return {
        id: c.id, name: c.name, status: c.status,
        recipients: Object.values(by).reduce((a, b) => a + b, 0),
        sent: by.sent || 0, delivered: by.delivered || 0, read: by.read || 0,
        failed: by.failed || 0, replies: by.replied || 0,
      };
    })
  );

  const feed = recentActivities.map((a) => ({
    id: a.id,
    title: a.title,
    actorName: a.actor?.name || "System",
    type: a.type,
    leadName: a.lead ? [a.lead.firstName, a.lead.lastName].filter(Boolean).join(" ") || a.lead.company : null,
    createdAt: a.createdAt,
  }));

  return Response.json({
    kpis: {
      totalLeads, newLeads, assignedLeads, contactedLeads,
      whatsappConversations: conversations,
      callsToday, messagesSent, messagesDelivered, replies,
      followupsDue, overdueFollowups, convertedCustomers: convertedLeads,
      optOuts,
    },
    feed,
    campaignStats,
    employeeActivity,
  });
}
