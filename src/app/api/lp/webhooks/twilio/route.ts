import { db } from "@/lib/db";
import { getCallingConfigRaw } from "@/lib/lp/calling";
import { validateTwilioSignature } from "@/lib/lp/calling-twilio";
import { logAudit } from "@/lib/lp/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/lp/webhooks/twilio — Twilio CallStatus event receiver.
//
// Twilio POSTs form-encoded events (initiated / ringing / answered /
// completed) for every provider call the CRM creates. Requests are verified
// FAIL-CLOSED against X-Twilio-Signature (HMAC-SHA1 over the public callback
// URL + sorted params, keyed with the saved Auth Token) — an unsigned or
// forged webhook is rejected and NOTHING is written.
//
// Status mapping into the honest Call record:
//   initiated/ringing → ringing
//   answered (in-progress) → in_progress (answeredAt stamped)
//   completed  → completed + durationSec = provider CallDuration
//   busy/no-answer/canceled → busy / no_answer / missed
//   failed → failed (+ reason in notes)
function parseForm(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(body)) out[k] = v;
  return out;
}

const CALL_STATUS_MAP: Record<string, string> = {
  initiated: "ringing",
  ringing: "ringing",
  "in-progress": "in_progress",
  completed: "completed",
  busy: "busy",
  "no-answer": "no_answer",
  canceled: "missed",
  failed: "failed",
};

export async function POST(req: Request) {
  const raw = await req.text();
  const params = parseForm(raw);

  // ── Fail-closed signature verification (spec §21) ──
  const cfg = await getCallingConfigRaw();
  const signature = req.headers.get("x-twilio-signature") || "";
  const authToken = cfg.authToken;
  if (!authToken) {
    return Response.json({ error: "Twilio webhook rejected — no calling provider auth token configured." }, { status: 403 });
  }
  const base = (cfg.callbackBaseUrl || "https://playbeat.digital").replace(/\/+$/, "");
  const publicUrl = `${base}/api/lp/webhooks/twilio`;
  if (!validateTwilioSignature(authToken, publicUrl, params, signature)) {
    return Response.json({ error: "Twilio webhook signature verification failed." }, { status: 403 });
  }

  const callSid = params.CallSid;
  const callStatus = params.CallStatus || "";
  const crmStatus = CALL_STATUS_MAP[callStatus];
  if (!callSid || !crmStatus) {
    return Response.json({ ok: true, ignored: true }); // unrelated event — ack, don't guess
  }

  const call = await db.call.findFirst({ where: { providerCallId: callSid } });
  if (!call) return Response.json({ ok: true, ignored: "unknown CallSid" });

  const patch: Record<string, unknown> = { status: crmStatus };
  if (callStatus === "in-progress") patch.endedAt = null;
  if (callStatus === "in-progress" && !call.startedAt) patch.startedAt = new Date();
  if (callStatus === "completed") {
    const dur = Number(params.CallDuration || "");
    patch.endedAt = params.Timestamp ? new Date(params.Timestamp) : new Date();
    if (Number.isFinite(dur) && dur >= 0) patch.durationSec = Math.round(dur); // provider-authoritative
  }
  if (callStatus === "failed") {
    const reason = params.ErrorMessage ? ` — ${params.ErrorMessage}` : "";
    patch.notes = `${call.notes ? call.notes + " " : ""}Provider reported failed${reason}`.trim();
  }
  await db.call.update({ where: { id: call.id }, data: patch });

  await logAudit({
    action: "call.provider_event",
    entity: "call",
    entityId: call.id,
    actorName: "provider:twilio",
    detail: `CallSid=${callSid} CallStatus=${callStatus} → ${crmStatus}${params.CallDuration ? ` duration=${params.CallDuration}s` : ""}`,
  });
  return Response.json({ ok: true });
}
