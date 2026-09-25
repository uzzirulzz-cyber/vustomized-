import { db } from "@/lib/db";
import { getAuthUser, can, jsonError } from "@/lib/lp/auth";
import { getWhatsAppConfig, saveWhatsAppConfig, maskConfig, waVerifyCredentials } from "@/lib/lp/whatsapp";
import { logAudit } from "@/lib/lp/activity";

export async function GET(req: Request) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "integrations.read")) return jsonError("Unauthorized", 401);
  const cfg = await getWhatsAppConfig();
  // NEVER return raw credentials — masked only (spec §16)
  return Response.json({ whatsapp: maskConfig(cfg) });
}

export async function POST(req: Request) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "integrations.manage")) return jsonError("Only the super admin can change integration credentials.", 403);
  const body = await req.json().catch(() => ({}));

  const patch: Record<string, string> = {};
  for (const key of ["phoneNumberId", "wabaId", "accessToken", "graphVersion", "webhookVerifyToken"] as const) {
    if (typeof body[key] === "string" && body[key].trim() !== "") patch[key] = body[key].trim();
  }
  await saveWhatsAppConfig(patch);
  const cfg = await getWhatsAppConfig();
  await logAudit({ actorId: user.id, actorName: user.name, action: "integration.whatsapp.save", entity: "integration", entityId: "whatsapp", detail: Object.keys(patch).join(",") });
  return Response.json({ whatsapp: maskConfig(cfg) });
}

// Real credential verification against Graph API (spec §25: display the actual
// provider result, never a simulated success).
export async function PUT(req: Request) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "integrations.manage")) return jsonError("Only the super admin can test credentials.", 403);
  const result = await waVerifyCredentials();
  await logAudit({
    actorId: user.id, actorName: user.name, action: "integration.whatsapp.verify",
    detail: result.ok ? "credential check OK" : `credential check FAILED: ${result.error}`,
  });
  if (!result.ok) return Response.json({ ok: false, error: result.error, errorCode: result.errorCode }, { status: 200 });
  const data = result.data as { display_phone_number?: string; verified_name?: string };
  return Response.json({
    ok: true,
    displayPhoneNumber: data.display_phone_number,
    verifiedName: data.verified_name,
  });
}
