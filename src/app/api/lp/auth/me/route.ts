import { getAuthUser } from "@/lib/lp/auth";

export async function GET(req: Request) {
  const user = await getAuthUser(req);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ user });
}
