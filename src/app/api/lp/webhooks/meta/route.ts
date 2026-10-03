// Canonical Meta webhook endpoint (spec §10/§48) — re-exports the shared
// handlers from the WhatsApp route. One URL subscribes BOTH objects:
//   object=whatsapp_business_account → WhatsApp Cloud API
//   object=page                      → Facebook Page / Messenger (bixby)
// Use this URL in Meta App → Webhooks (or the per-product webhook config).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export { GET, POST } from "../whatsapp/route";
