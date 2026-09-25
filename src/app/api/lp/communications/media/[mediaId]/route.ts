import { createHmac, timingSafeEqual } from "crypto";
import { getAuthUser } from "@/lib/lp/auth";
import { waGetMediaUrl } from "@/lib/lp/whatsapp";

export const runtime = "nodejs";

// GET /api/lp/communications/media/:mediaId
//
// Authenticated media proxy for the inbox timeline. Meta media URLs are
// short-lived and require the access token, so the browser never sees them:
// this endpoint verifies the CRM session (Bearer header OR the lp_refresh
// cookie sent automatically by same-origin <img>/<video>/<a> tags), then
// 302-redirects to a FRESH signed Meta CDN URL.
//
// A short-lived signed token (?t=…) is also accepted for contexts where
// cookies cannot ride along.

const JWT_SECRET = process.env.LP_JWT_SECRET || "lp-dev-secret-change-me";
const MEDIA_TTL_SEC = 10 * 60;

function macFor(mediaId: string, exp: number): string {
  return createHmac("sha256", JWT_SECRET).update(`${mediaId}.${exp}`).digest("hex");
}

function verifyToken(mediaId: string, token: string): boolean {
  try {
    const [expStr, mac] = token.split(".");
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
    return timingSafeEqual(Buffer.from(mac, "hex"), Buffer.from(macFor(mediaId, exp), "hex"));
  } catch {
    return false;
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ mediaId: string }> }) {
  const { mediaId } = await params;
  const url = new URL(req.url);

  const user = await getAuthUser(req).catch(() => null);
  const t = url.searchParams.get("t");
  const tokenOk = Boolean(t && verifyToken(mediaId, t));
  if (!user && !tokenOk) return Response.json({ error: "Unauthorized" }, { status: 401 });

  // ?issue=1 → hand out a short-lived token for this media id.
  if (url.searchParams.get("issue") === "1") {
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const exp = Math.floor(Date.now() / 1000) + MEDIA_TTL_SEC;
    return Response.json({ token: `${exp}.${macFor(mediaId, exp)}`, ttlSec: MEDIA_TTL_SEC });
  }

  const res = await waGetMediaUrl(mediaId);
  if (!res.ok) {
    return Response.json({ error: res.error }, { status: res.httpStatus === 404 ? 404 : 502 });
  }
  return Response.redirect(res.data.url, 302);
}
