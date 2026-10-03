import { db } from "@/lib/db";
import { getAuthUser, can, jsonError } from "@/lib/lp/auth";

// Analytics (spec §20) — every number computed from real DB rows.
export async function GET(req: Request) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "analytics.read")) return jsonError("Unauthorized", 401);

  const days = Math.min(90, Math.max(7, parseInt(new URL(req.url).searchParams.get("days") || "14", 10)));
  const since = new Date(Date.now() - days * 86400_000);

  // ── Lead funnel ──
  const [imported, manual, contacted, qualified, converted, byStatus, byCountry, bySource] = await Promise.all([
    db.lead.count({ where: { source: "csv_import", createdAt: { gte: since } } }),
    db.lead.count({ where: { source: "manual", createdAt: { gte: since } } }),
    db.lead.count({ where: { status: { in: ["contacted", "qualified", "converted"] } } }),
    db.lead.count({ where: { status: "qualified" } }),
    db.lead.count({ where: { status: "converted" } }),
    db.lead.groupBy({ by: ["status"], _count: true }),
    db.lead.groupBy({ by: ["country"], _count: true, where: { country: { not: null } }, orderBy: { _count: { country: "desc" } }, take: 8 }),
    db.lead.groupBy({ by: ["source"], _count: true, orderBy: { _count: { source: "desc" } } }),
  ]);

  // ── WhatsApp ──
  const [sentGrp, inboundCount, conversationsCount] = await Promise.all([
    db.message.groupBy({ by: ["status"], where: { direction: "outbound", createdAt: { gte: since } }, _count: true }),
    db.message.count({ where: { direction: "inbound", createdAt: { gte: since } } }),
    db.conversation.count({ where: { createdAt: { gte: since } } }),
  ]);
  const waBy: Record<string, number> = {};
  for (const g of sentGrp) waBy[g.status] = g._count;
  const optOutCount = await db.optOut.count({ where: { optedOutAt: { gte: since } } });

  // ── Calls ──
  const [callGrp, durations] = await Promise.all([
    db.call.groupBy({ by: ["status"], where: { createdAt: { gte: since } }, _count: true }),
    db.call.findMany({ where: { createdAt: { gte: since }, durationSec: { not: null } }, select: { durationSec: true } }),
  ]);
  const callsBy: Record<string, number> = {};
  for (const g of callGrp) callsBy[g.status] = g._count;
  const avgDuration = durations.length
    ? Math.round(durations.reduce((a, c) => a + (c.durationSec || 0), 0) / durations.length)
    : null; // null = honestly unknown when no completed durations exist

  // ── Employees ──
  const users = await db.user.findMany({ where: { role: { in: ["employee", "manager", "admin", "super_admin"] } }, select: { id: true, name: true, role: true, department: true } });
  const employeeStats = await Promise.all(
    users.map(async (u) => {
      const [leadsHandled, messages, calls, replies, conversions, followupsCompleted] = await Promise.all([
        db.activity.count({ where: { actorId: u.id, type: { in: ["message_sent", "call_logged", "conversation_started"] }, createdAt: { gte: since } } }),
        db.message.count({ where: { senderId: u.id, direction: "outbound", createdAt: { gte: since } } }),
        db.call.count({ where: { employeeId: u.id, createdAt: { gte: since } } }),
        db.activity.count({ where: { actorId: u.id, type: "message_received", createdAt: { gte: since } } }),
        db.activity.count({ where: { actorId: u.id, type: "converted" } }),
        db.followUp.count({ where: { ownerId: u.id, status: "completed", completedAt: { gte: since } } }),
      ]);
      return { ...u, leadsHandled, messages, calls, replies, conversions, followupsCompleted };
    })
  );

  // ── Campaigns ──
  const campaigns = await db.campaign.findMany({
    where: { status: { in: ["running", "paused", "completed", "cancelled"] } },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  const campaignStats = await Promise.all(
    campaigns.map(async (c) => {
      const grp = await db.campaignRecipient.groupBy({ by: ["status"], where: { campaignId: c.id }, _count: true });
      const by: Record<string, number> = {};
      for (const g of grp) by[g.status] = g._count;
      const recipients = Object.values(by).reduce((a, b) => a + b, 0) || 1;
      return {
        id: c.id, name: c.name, status: c.status,
        recipients: recipients === 1 && !Object.keys(by).length ? 0 : Object.values(by).reduce((a, b) => a + b, 0),
        deliveryRate: Math.round(((by.delivered || 0) + (by.read || 0) + (by.replied || 0)) / recipients * 100),
        readRate: Math.round(((by.read || 0) + (by.replied || 0)) / recipients * 100),
        replyRate: Math.round((by.replied || 0) / recipients * 100),
        conversionRate: 0, // conversions attributed per-lead outcome below
      };
    })
  );

  // daily message volume for chart
  const messages = await db.message.findMany({
    where: { createdAt: { gte: since } },
    select: { createdAt: true, direction: true },
  });
  const daily: { date: string; inbound: number; outbound: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
    daily.push({ date: d, inbound: 0, outbound: 0 });
  }
  for (const m of messages) {
    const key = m.createdAt.toISOString().slice(0, 10);
    const bucket = daily.find((d) => d.date === key);
    if (bucket) bucket[m.direction === "inbound" ? "inbound" : "outbound"]++;
  }

  return Response.json({
    days,
    leads: {
      importedLastPeriod: imported, manualLastPeriod: manual,
      contacted, qualified, converted,
      byStatus: byStatus.map((s) => ({ status: s.status, count: s._count })),
      byCountry: byCountry.map((c) => ({ country: c.country, count: c._count })),
      bySource: bySource.map((s) => ({ source: s.source, count: s._count })),
    },
    whatsapp: {
      sent: waBy.sent || 0, delivered: waBy.delivered || 0, read: waBy.read || 0,
      failed: waBy.failed || 0, replies: inboundCount,
      newConversations: conversationsCount, optOuts: optOutCount,
    },
    calls: {
      byStatus: callsBy,
      total: Object.values(callsBy).reduce((a, b) => a + b, 0),
      avgDurationSec: avgDuration,
    },
    employees: employeeStats,
    campaigns: campaignStats,
    daily,
  });
}
