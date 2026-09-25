import { db } from "@/lib/db";
import { getAuthUser, can, jsonError, hashPassword } from "@/lib/lp/auth";
import { logAudit } from "@/lib/lp/activity";

const ROLES = ["super_admin", "admin", "manager", "employee", "viewer"];

export async function GET(req: Request) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "employees.read")) return jsonError("Unauthorized", 401);

  const employees = await db.user.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, name: true, phone: true, role: true, department: true, status: true, createdAt: true },
  });

  // Real per-employee counters (spec §10) — computed, never stored/faked
  const stats = await Promise.all(
    employees.map(async (e) => {
      const [assignedLeads, calls, messages, conversations, conversions, followupsCompleted] = await Promise.all([
        db.lead.count({ where: { assignedToId: e.id, status: { not: "archived" } } }),
        db.call.count({ where: { employeeId: e.id } }),
        db.message.count({ where: { senderId: e.id, direction: "outbound" } }),
        db.conversation.count({ where: { assignedToId: e.id } }),
        db.activity.count({ where: { actorId: e.id, type: "converted" } }),
        db.followUp.count({ where: { ownerId: e.id, status: "completed" } }),
      ]);
      return { userId: e.id, assignedLeads, calls, messages, conversations, conversions, followupsCompleted };
    })
  );

  return Response.json({ employees: employees.map((e, i) => ({ ...e, stats: stats[i] })) });
}

export async function POST(req: Request) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "employees.manage")) return jsonError("Unauthorized", 401);
  const body = await req.json().catch(() => ({}));
  const { name, email, password, role, department, phone } = body;
  if (!name || !email || !password) return jsonError("name, email and password are required.", 400);
  if (String(password).length < 8) return jsonError("Password must be at least 8 characters.", 400);
  if (role && !ROLES.includes(role)) return jsonError(`role must be one of: ${ROLES.join(", ")}`, 400);
  if (role === "super_admin" && user.role !== "super_admin") return jsonError("Only a super admin can create another super admin.", 403);

  const exists = await db.user.findUnique({ where: { email: String(email).toLowerCase().trim() } });
  if (exists) return jsonError("A user with this email already exists.", 409);

  const employee = await db.user.create({
    data: {
      name: String(name).slice(0, 120),
      email: String(email).toLowerCase().trim(),
      passwordHash: hashPassword(String(password)),
      role: role || "employee",
      department: department || null,
      phone: phone || null,
    },
    select: { id: true, email: true, name: true, role: true, department: true, status: true, createdAt: true },
  });
  await logAudit({ actorId: user.id, actorName: user.name, action: "employee.create", entity: "user", entityId: employee.id, detail: `${employee.email} (${employee.role})` });
  return Response.json({ employee }, { status: 201 });
}
