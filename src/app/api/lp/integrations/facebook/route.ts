import { db } from "@/lib/db";
import { getAuthUser, can, jsonError } from "@/lib/lp/auth";
import { getFacebookConfig, saveFacebookConfig, maskFacebookConfig, fbVerifyCredentials } from "@/lib/lp/facebook";
import { logAudit } from "@/lib/lp/activity";

export async function GET(req: Request) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "integrations.read")) return jsonError("Unauthorized", 401);
  const cfg = await getFacebookConfig();
  // NEVER return raw credentials — masked only (spec §46)
  return Response.json({ facebook: maskFacebookConfig(cfg) });
}

export async function POST(req: Request) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "integrations.manage")) return jsonError("Only the super admin can change integration credentials.", 403);
  const body = await req.json().catch(() => ({}));

  const patch: Record<string, string> = {};
  for (const key of ["pageId", "accessToken", "graphVersion", "webhookVerifyToken"] as const) {
    if (typeof body[key] === "string" && body[key].trim() !== "") patch[key] = body[key].trim();
  }
  await saveFacebookConfig(patch);
  const cfg = await getFacebookConfig();
  await logAudit({ actorId: user.id, actorName: user.name, action: "integration.facebook.save", entity: "integration", entityId: "facebook", detail: Object.keys(patch).join(",") });
  return Response.json({ facebook: maskFacebookConfig(cfg) });
}

// Real credential verification against the Graph API Page node (spec §25:
// display the actual provider result, never a simulated success).
export async function PUT(req: Request) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "integrations.manage")) return jsonError("Only the super admin can test credentials.", 403);
  const cfg = await getFacebookConfig();
  if (!cfg.pageId || !cfg.accessToken) return Response.json({ ok: false, error: "Page ID and access token are required." }, { status: 200 });
  const result = await fbVerifyCredentials();
  await logAudit({
    actorId: user.id, actorName: user.name, action: "integration.facebook.verify",
    detail: result.ok ? "credential check OK" : `credential check FAILED: ${result.error}`,
  });
  if (!result.ok) return Response.json({ ok: false, error: result.error, errorCode: result.errorCode }, { status: 200 });
  const data = result.data as { id?: string; name?: string; category?: string };
  return Response.json({
    ok: true,
    pageId: data.id,
    pageName: data.name,
    category: data.category,
  });
}
