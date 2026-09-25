import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/lp/auth";

export async function POST(req: Request) {
  const user = await getAuthUser(req);
  if (user) {
    // invalidate every refresh token for this user
    await db.user.update({ where: { id: user.id }, data: { refreshVer: { increment: 1 } } });
  }
  const res = Response.json({ ok: true });
  res.headers.append("Set-Cookie", `lp_refresh=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
  return res;
}
