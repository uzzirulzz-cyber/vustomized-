import { db } from "@/lib/db";
import { getAuthUser, can, jsonError } from "@/lib/lp/auth";
import { waMarkRead } from "@/lib/lp/whatsapp";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "conversations.read")) return jsonError("Unauthorized", 401);
  const { id } = await params;

  const conversation = await db.conversation.findUnique({ where: { id } });
  if (!conversation) return jsonError("Conversation not found", 404);

  // Mark unread inbound messages as read locally + at the provider (best-effort)
  const unread = await db.message.findMany({
    where: { conversationId: id, direction: "inbound", status: "delivered" },
    select: { waMessageId: true },
    take: 50,
  });
  for (const m of unread) {
    if (m.waMessageId) await waMarkRead(m.waMessageId);
  }
  await db.message.updateMany({
    where: { conversationId: id, direction: "inbound", status: { in: ["delivered", "sent"] } },
    data: { status: "read", statusAt: new Date() },
  });
  await db.conversation.update({ where: { id }, data: { unreadCount: 0 } });

  return Response.json({ ok: true });
}
