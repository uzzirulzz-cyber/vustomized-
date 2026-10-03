import { db } from "@/lib/db";
import {
  verifyPassword, signToken,
  ACCESS_TTL_SEC, REFRESH_TTL_SEC, jsonError,
} from "@/lib/lp/auth";
import { logAudit } from "@/lib/lp/activity";

export async function POST(req: Request) {
  const { email, password } = await req.json().catch(() => ({}));
  if (!email || !password) return jsonError("Email and password are required.", 400);

  const user = await db.user.findUnique({ where: { email: String(email).toLowerCase().trim() } });
  if (!user || user.status !== "active" || !verifyPassword(String(password), user.passwordHash)) {
    return jsonError("Invalid credentials.", 401);
  }

  const accessToken = signToken(user.id, "access", user.refreshVer, ACCESS_TTL_SEC);
  const refreshToken = signToken(user.id, "refresh", user.refreshVer, REFRESH_TTL_SEC);

  await logAudit({
    actorId: user.id,
    actorName: user.name,
    action: "auth.login",
    entity: "user",
    entityId: user.id,
    detail: `${user.email} signed in`,
  });

  const res = Response.json({
    accessToken,
    expiresIn: ACCESS_TTL_SEC,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, department: user.department },
  });
  res.headers.append(
    "Set-Cookie",
    `lp_refresh=${encodeURIComponent(refreshToken)}; HttpOnly; Path=/; Max-Age=${REFRESH_TTL_SEC}; SameSite=Lax`
  );
  return res;
}
