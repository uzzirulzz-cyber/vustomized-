import { db } from "@/lib/db";
import { verifyToken, signToken, ACCESS_TTL_SEC, REFRESH_TTL_SEC, jsonError } from "@/lib/lp/auth";

export async function POST(req: Request) {
  const cookie = req.headers.get("cookie") || "";
  const m = cookie.match(/lp_refresh=([^;]+)/);
  if (!m) return jsonError("No refresh token.", 401);
  const payload = verifyToken(decodeURIComponent(m[1]), "refresh");
  if (!payload) return jsonError("Refresh token invalid or expired.", 401);

  const user = await db.user.findUnique({ where: { id: payload.sub } });
  if (!user || user.status !== "active" || user.refreshVer !== payload.ver) {
    return jsonError("Session revoked.", 401);
  }
  const accessToken = signToken(user.id, "access", user.refreshVer, ACCESS_TTL_SEC);
  const refreshToken = signToken(user.id, "refresh", user.refreshVer, REFRESH_TTL_SEC);
  const res = Response.json({ accessToken, expiresIn: ACCESS_TTL_SEC, user: { id: user.id, email: user.email, name: user.name, role: user.role, department: user.department } });
  res.headers.append(
    "Set-Cookie",
    `lp_refresh=${encodeURIComponent(refreshToken)}; HttpOnly; Path=/; Max-Age=${REFRESH_TTL_SEC}; SameSite=Lax`
  );
  return res;
}
