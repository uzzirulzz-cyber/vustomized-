import { getAuthUser, can, jsonError } from "@/lib/lp/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = ["available", "busy", "on_call", "away", "offline"];
const ONLINE_WINDOW_MS = 2 * 60 * 1000; // heartbeat-derived "online"

// GET — team presence board (real heartbeats, real assignments)
export async function GET(req: Request) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "conversations.read")) return jsonError("Unauthorized", 401);

  const users = await db.user.findMany({
    where: { status: "active" },
    select: { id: true, name: true, email: true, role: true, department: true, presenceStatus: true, lastSeenAt: true },
    orderBy: { name: "asc" },
  });

  const openCounts = await db.conversation.groupBy({
    by: ["assignedToId"],
    where: { status: { not: "closed" } },
    _count: { _all: true },
  });
  const unread = await db.conversation.groupBy({
    by: ["assignedToId"],
    where: { status: { not: "closed" }, unreadCount: { gt: 0 } },
    _count: { _all: true },
  });

  const members = users.map((u) => {
    const seen = u.lastSeenAt ? u.lastSeenAt.getTime() : 0;
    const derivedOnline = Date.now() - seen < ONLINE_WINDOW_MS;
    let status = u.presenceStatus || "offline";
    if (status !== "offline" && !derivedOnline && status !== "away") status = `${status}`; // keep the agent's chosen state, mark stale below
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      department: u.department,
      status,
      derivedOnline,
      lastSeenAt: u.lastSeenAt?.toISOString() ?? null,
      openConversations: openCounts.find((c) => c.assignedToId === u.id)?._count._all ?? 0,
      unreadConversations: unread.find((c) => c.assignedToId === u.id)?._count._all ?? 0,
    };
  });

  return Response.json({ members });
}

// POST { status } — agent sets presence; called with { heartbeat:true } by the
// client timer to keep lastSeenAt fresh (that is what makes "online" real).
export async function POST(req: Request) {
  const user = await getAuthUser(req);
  if (!user) return jsonError("Unauthorized", 401);
  const body = await req.json().catch(() => ({}));

  const patch: { presenceStatus?: string; lastSeenAt: Date } = { lastSeenAt: new Date() };
  if (!body.heartbeat) {
    const status = String(body.status || "");
    if (!STATUSES.includes(status)) return jsonError(`status must be one of: ${STATUSES.join(", ")}`, 400);
    patch.presenceStatus = status;
  }
  await db.user.update({ where: { id: user.id }, data: patch });
  return Response.json({ ok: true, status: patch.presenceStatus ?? null });
}
