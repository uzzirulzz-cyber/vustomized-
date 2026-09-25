import { db } from "@/lib/db";
import { getAuthUser, can, jsonError } from "@/lib/lp/auth";
import { logAudit } from "@/lib/lp/activity";

const ROLES = ["super_admin", "admin", "manager", "employee", "viewer"];

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "employees.manage")) return jsonError("Unauthorized", 401);
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const target = await db.user.findUnique({ where: { id } });
  if (!target) return jsonError("Employee not found", 404);

  const data: Record<string, unknown> = {};
  if ("name" in body) data.name = String(body.name).slice(0, 120);
  if ("phone" in body) data.phone = body.phone || null;
  if ("department" in body) data.department = body.department || null;
  if ("role" in body) {
    if (!ROLES.includes(body.role)) return jsonError(`role must be one of: ${ROLES.join(", ")}`, 400);
    if (body.role === "super_admin" && user.role !== "super_admin") return jsonError("Only a super admin can grant super admin.", 403);
    if (target.id === user.id && body.role !== user.role) return jsonError("You cannot change your own role.", 400);
    data.role = body.role;
  }
  if ("status" in body) {
    if (!["active", "disabled"].includes(body.status)) return jsonError("status must be active or disabled", 400);
    if (target.id === user.id) return jsonError("You cannot disable your own account.", 400);
    data.status = body.status;
    if (body.status === "disabled") data.refreshVer = { increment: 1 };
  }
  if ("password" in body && body.password) {
    if (String(body.password).length < 8) return jsonError("Password must be at least 8 characters.", 400);
    const { hashPassword } = await import("@/lib/lp/auth");
    data.passwordHash = hashPassword(String(body.password));
    data.refreshVer = { increment: 1 };
  }

  const employee = await db.user.update({
    where: { id },
    data,
    select: { id: true, email: true, name: true, role: true, department: true, status: true },
  });
  await logAudit({ actorId: user.id, actorName: user.name, action: "employee.update", entity: "user", entityId: id, detail: JSON.stringify(Object.keys(data)) });
  return Response.json({ employee });
}
