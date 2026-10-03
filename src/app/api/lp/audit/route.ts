import { db } from "@/lib/db";
import { getAuthUser, can, jsonError } from "@/lib/lp/auth";

export async function GET(req: Request) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "audit.read")) return jsonError("Unauthorized", 401);
  const logs = await db.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  const webhookEvents = await db.webhookEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  return Response.json({ logs, webhookEvents });
}
