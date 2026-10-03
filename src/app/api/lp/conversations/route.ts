import { db } from "@/lib/db";
import { getAuthUser, can, jsonError } from "@/lib/lp/auth";

// Conversation inbox lists (spec §2): all / unread / mine / unassigned /
// open / pending / resolved / hot / warm / cold + search by name, number,
// message content.
export async function GET(req: Request) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "conversations.read")) return jsonError("Unauthorized", 401);

  const url = new URL(req.url);
  const filter = url.searchParams.get("filter") || "all";
  const q = url.searchParams.get("q")?.trim() || "";

  const where: Record<string, unknown> = {
    // Archived leads are out of active rotation — their conversations leave
    // the inbox (rows are kept, nothing is lost; reactivating the lead
    // restores the thread).
    lead: { is: { status: { not: "archived" } } },
  };
  if (filter === "unread") where.unreadCount = { gt: 0 };
  if (filter === "mine") where.assignedToId = user.id;
  if (filter === "unassigned") where.assignedToId = null;
  if (filter === "open") where.status = "open";
  if (filter === "pending") where.status = "pending";
  if (filter === "resolved") where.status = "resolved";
  if (filter === "hot") where.lead = { is: { status: { not: "archived" }, score: { gte: 70 } } };
  if (filter === "warm") where.lead = { is: { status: { not: "archived" }, score: { gte: 40, lt: 70 } } };
  if (filter === "cold") where.lead = { is: { status: { not: "archived" }, score: { lt: 40 } } };
  if (filter === "whatsapp") where.channel = "whatsapp";
  if (filter === "facebook") where.channel = "facebook";
  if (q) {
    where.OR = [
      { waPhone: { contains: q } },
      { lastMessagePreview: { contains: q } },
      { lead: { is: { OR: [{ firstName: { contains: q } }, { lastName: { contains: q } }, { company: { contains: q } }, { email: { contains: q } }] } } },
    ];
  }

  const conversations = await db.conversation.findMany({
    where,
    orderBy: [{ lastMessageAt: "desc" }],
    take: 100,
    include: {
      lead: { select: { id: true, firstName: true, lastName: true, company: true, country: true, status: true, score: true, tags: true, optedOut: true } },
      assignedTo: { select: { id: true, name: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  return Response.json({ conversations });
}
