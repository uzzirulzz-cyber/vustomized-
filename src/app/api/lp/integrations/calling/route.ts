import { getAuthUser, can, jsonError } from "@/lib/lp/auth";
import { getCallingConfigMasked, getCallingAdapter, saveCallingConfig, listSupportedCallingProviders, CALLING_PROVIDER_FIELDS } from "@/lib/lp/calling";
import { logAudit } from "@/lib/lp/activity";

export const runtime = "nodejs";

// GET — masked calling provider configuration (integrations.read)
export async function GET(req: Request) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "integrations.read")) return jsonError("Unauthorized", 401);
  const masked = await getCallingConfigMasked();
  const providers = await listSupportedCallingProviders();
  return Response.json({ calling: masked, supportedProviders: providers, providerFields: CALLING_PROVIDER_FIELDS });
}

// PUT — save calling provider configuration (super admin only). Secrets are
// stored server-side (Integration.configJson) and NEVER returned unmasked.
export async function PUT(req: Request) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "integrations.manage")) return jsonError("Unauthorized — super admin only.", 403);
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, string> = {};
  for (const [k, v] of Object.entries(body ?? {})) {
    if (typeof v === "string") patch[k] = v.slice(0, 500);
  }
  await saveCallingConfig(patch);
  await logAudit({ actorId: user.id, actorName: user.name, action: "calling.config.save", entity: "integration", entityId: "telephony", detail: `provider=${patch.provider || "(unchanged)"}` });
  const masked = await getCallingConfigMasked();
  return Response.json({ ok: true, calling: masked });
}

// POST { action: "test" } — REAL provider reachability probe.
// NEVER fakes success: with no adapter for the configured provider the test
// honestly fails with the reason (spec §22/§24).
export async function POST(req: Request) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "integrations.read")) return jsonError("Unauthorized", 401);
  const { action } = await req.json().catch(() => ({}));
  if (action !== "test") return jsonError("action must be \"test\"", 400);

  const cfg = await getCallingConfigMasked();
  if (!cfg.configured) {
    return Response.json({
      ok: false,
      status: "not_configured",
      error: "NOT CONFIGURED — no calling provider credentials have been saved. Save a provider configuration first.",
    });
  }
  const adapter = await getCallingAdapter();
  const res = await adapter.healthCheck();
  if (!res.ok) {
    return Response.json({ ok: false, status: "registration_failed", error: `✕ Connection failed — ${res.error}` });
  }
  return Response.json({ ok: true, status: "registered", detail: res.data });
}
