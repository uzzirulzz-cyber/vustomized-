import { getAuthUser, can, jsonError } from "@/lib/lp/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/lp/communications/stats — every number below is computed from the
// stored communication data (Message / Call / Conversation). No demo values.
export async function GET(req: Request) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "conversations.read")) return jsonError("Unauthorized", 401);

  const now = Date.now();
  const startOfToday = new Date(new Date().setHours(0, 0, 0, 0));
  const d14 = new Date(now - 13 * 86400000);
  d14.setHours(0, 0, 0, 0);

  const [convOpen, convUnassigned, unreadAgg, convTotal] = await Promise.all([
    db.conversation.count({ where: { status: { not: "closed" } } }),
    db.conversation.count({ where: { status: { not: "closed" }, assignedToId: null } }),
    db.conversation.aggregate({ _sum: { unreadCount: true } }),
    db.conversation.count({}),
  ]);

  const [msgsToday, msgsIn14, callsToday, callsAnswered, callsMissed, callsAll, templatesApproved] = await Promise.all([
    db.message.count({ where: { createdAt: { gte: startOfToday } } }),
    db.message.findMany({ where: { createdAt: { gte: d14 } }, select: { direction: true, kind: true, createdAt: true, conversationId: true, status: true, senderId: true } }),
    db.call.count({ where: { createdAt: { gte: startOfToday } } }),
    db.call.count({ where: { status: "completed" } }),
    db.call.count({ where: { status: { in: ["missed", "no_answer"] } } }),
    db.call.findMany({ select: { status: true, outcome: true, direction: true, durationSec: true, createdAt: true, employeeId: true }, take: 2000, orderBy: { createdAt: "desc" } }),
    db.template.count({ where: { approvalStatus: "meta_approved", archived: false } }),
  ]);

  const durAgg = await db.call.aggregate({ where: { durationSec: { not: null } }, _avg: { durationSec: true }, _count: { _all: true } });

  // ── 14-day series: WhatsApp volume + calls per day ──
  const days: { date: string; label: string; inbound: number; outbound: number; calls: number; answered: number }[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(d14.getTime() + i * 86400000);
    days.push({ date: d.toISOString().slice(0, 10), label: d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }), inbound: 0, outbound: 0, calls: 0, answered: 0 });
  }
  const dayIdx = new Map(days.map((d, i) => [d.date, i]));
  for (const m of msgsIn14) {
    const key = new Date(m.createdAt).toISOString().slice(0, 10);
    const i = dayIdx.get(key);
    if (i == null) continue;
    if (m.direction === "inbound") days[i].inbound++; else days[i].outbound++;
  }
  for (const c of callsAll) {
    const key = new Date(c.createdAt).toISOString().slice(0, 10);
    const i = dayIdx.get(key);
    if (i == null) continue;
    days[i].calls++;
    if (c.status === "completed") days[i].answered++;
  }

  // ── Average first response time (inbound → next outbound, per conversation) ──
  let avgFirstResponseSec: number | null = null;
  {
    const byConv = new Map<string, { direction: string; createdAt: Date }[]>();
    for (const m of msgsIn14) {
      if (!byConv.has(m.conversationId)) byConv.set(m.conversationId, []);
      byConv.get(m.conversationId)!.push({ direction: m.direction, createdAt: new Date(m.createdAt) });
    }
    let total = 0, n = 0;
    for (const msgs of byConv.values()) {
      msgs.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      let pendingInbound: Date | null = null;
      for (const m of msgs) {
        if (m.direction === "inbound") { if (!pendingInbound) pendingInbound = m.createdAt; }
        else if (pendingInbound) {
          total += (m.createdAt.getTime() - pendingInbound.getTime()) / 1000;
          n++; pendingInbound = null;
        }
      }
    }
    avgFirstResponseSec = n > 0 ? Math.round(total / n) : null;
  }

  // ── Call outcomes breakdown ──
  const outcomes: Record<string, number> = {};
  for (const c of callsAll) {
    const key = c.outcome || c.status || "unknown";
    outcomes[key] = (outcomes[key] || 0) + 1;
  }

  // ── Agent activity (7d) ──
  const d7 = new Date(now - 7 * 86400000);
  const [agents, sent7, calls7] = await Promise.all([
    db.user.findMany({ where: { status: "active" }, select: { id: true, name: true, role: true, presenceStatus: true, lastSeenAt: true } }),
    db.message.groupBy({ by: ["senderId"], where: { direction: "outbound", createdAt: { gte: d7 } }, _count: { _all: true } }),
    db.call.groupBy({ by: ["employeeId"], where: { createdAt: { gte: d7 } }, _count: { _all: true } }),
  ]);
  const agentActivity = agents.map((a) => ({
    id: a.id,
    name: a.name,
    role: a.role,
    presenceStatus: a.presenceStatus,
    lastSeenAt: a.lastSeenAt?.toISOString() ?? null,
    messagesSent7d: sent7.find((s) => s.senderId === a.id)?._count._all ?? 0,
    calls7d: calls7.find((c) => c.employeeId === a.id)?._count._all ?? 0,
  }));

  // ── Lead conversion (all-time + status split) ──
  const [leadsConverted, leadsTotal, hotLeads] = await Promise.all([
    db.lead.count({ where: { status: "converted" } }),
    db.lead.count({ where: { status: { not: "archived" } } }),
    db.lead.count({ where: { score: { gte: 70 }, status: { notIn: ["archived", "do_not_contact"] } } }),
  ]);

  const onCalls = agents.filter((a) => a.presenceStatus === "on_call").length;
  const available = agents.filter((a) => a.presenceStatus === "available" || (!a.presenceStatus && a.lastSeenAt && now - a.lastSeenAt.getTime() < 120000)).length;

  return Response.json({
    conversations: { total: convTotal, open: convOpen, unassigned: convUnassigned, unread: unreadAgg._sum.unreadCount ?? 0 },
    messages: { today: msgsToday, avgFirstResponseSec },
    calls: {
      today: callsToday,
      answered: callsAnswered,
      missed: callsMissed,
      avgDurationSec: durAgg._avg.durationSec != null ? Math.round(durAgg._avg.durationSec) : null,
      timedCount: durAgg._count._all,
      outcomes,
    },
    agents: { available, onCalls, total: agents.length, activity: agentActivity },
    templates: { approved: templatesApproved },
    leads: { converted: leadsConverted, total: leadsTotal, hot: hotLeads },
    series14d: days,
  });
}
