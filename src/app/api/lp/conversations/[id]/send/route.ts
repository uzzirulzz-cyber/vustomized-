import { db } from "@/lib/db";
import { getAuthUser, can, jsonError } from "@/lib/lp/auth";
import { getWhatsAppConfig, waSendText, waSendTemplate, waSendMedia, type MediaKind } from "@/lib/lp/whatsapp";
import { logActivity } from "@/lib/lp/activity";
import { emitToSocket } from "@/lib/lp/socket";
import { renderTemplate } from "@/lib/lp/render";

// POST { kind: "text" | "template" | "image" | "document" | "audio" | "video",
//        body?, templateId?, params?, mediaId?, filename?, caption?, replyToMessageId? }
// Sends through the REAL Meta Cloud API and records the honest result.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "conversations.send")) return jsonError("Unauthorized", 401);
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const conversation = await db.conversation.findUnique({
    where: { id },
    include: { lead: true },
  });
  if (!conversation) return jsonError("Conversation not found", 404);
  const lead = conversation.lead;
  const to = conversation.waPhone || lead.whatsapp;
  if (!to) return jsonError("This lead has no WhatsApp number.", 400);

  if (lead.optedOut) {
    return jsonError("This contact has OPTED OUT — messaging is blocked by the suppression list (compliance §15).", 403);
  }

  const cfg = await getWhatsAppConfig();
  if (!cfg.connected) {
    return jsonError("WhatsApp provider not connected. Add credentials under Integrations → WhatsApp.", 409);
  }

  // Build the outgoing message
  let messageBody = "";
  let kind = "text";
  let templateId: string | null = null;
  let mediaId: string | null = null;
  let filename: string | null = null;
  const employeeName = user.name;

  const leadCtx = {
    firstName: lead.firstName, lastName: lead.lastName, company: lead.company,
    country: lead.country, city: lead.city, employeeName,
    phone: lead.phone, email: lead.email,
  };

  const MEDIA_KINDS: MediaKind[] = ["image", "document", "audio", "video"];

  if (MEDIA_KINDS.includes(body.kind as MediaKind)) {
    mediaId = String(body.mediaId || "");
    if (!mediaId) return jsonError("mediaId required — upload the file first via /api/lp/communications/media/upload.", 400);
    kind = String(body.kind);
    filename = body.filename ? String(body.filename).slice(0, 200) : null;
    messageBody = body.caption ? String(body.caption).slice(0, 4000) : (filename || `[${kind}]`);
  } else if (body.kind === "template") {
    if (!body.templateId) return jsonError("templateId required", 400);
    const template = await db.template.findUnique({ where: { id: body.templateId } });
    if (!template) return jsonError("Template not found", 404);
    if (template.approvalStatus !== "meta_approved" && template.kind === "whatsapp_template") {
      return jsonError(
        `Template "${template.name}" is NOT Meta-approved (status: ${template.approvalStatus}). Business-initiated template messages require Meta approval — use a free-form message inside an open 24h service window instead.`,
        409
      );
    }
    messageBody = renderTemplate(template.bodyText, leadCtx);
    kind = "template";
    templateId = template.id;
  } else {
    messageBody = String(body.body || "").trim();
    if (!messageBody) return jsonError("Message body required", 400);
  }

  // Reply context — quote the customer's message (WhatsApp shows it threaded)
  let contextWaMessageId: string | null = null;
  if (body.replyToMessageId) {
    const target = await db.message.findFirst({ where: { id: String(body.replyToMessageId), conversationId: id } });
    if (target?.waMessageId) contextWaMessageId = target.waMessageId;
  }

  // Deliver through the provider — record exactly what Meta says.
  // Meta maps template components BY POSITION to the placeholders in the
  // approved body, so each {{placeholder}} occurrence (in order) becomes one
  // text parameter. Numeric placeholders ({{1}}, {{2}} …) are filled from the
  // caller-supplied `params` array (the Dialer collects one input per
  // placeholder); named variables ({{first_name}} …) render from lead context.
  // Variable-free templates send with [] as before.
  const result = await (async () => {
    if (kind !== "template" && kind !== "text") {
      return waSendMedia(to, kind as MediaKind, mediaId!, {
        caption: kind === "audio" ? undefined : messageBody,
        filename: kind === "document" ? filename || undefined : undefined,
        contextWaMessageId,
      });
    }
    if (kind !== "template") return waSendText(to, messageBody, contextWaMessageId);
    const t = (await db.template.findUnique({ where: { id: templateId! } }))!;
    const occurrences = [...t.bodyText.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((m) => m[1].toLowerCase());
    const callerParams = Array.isArray(body.params) ? body.params : [];
    const positionals = occurrences.map((v, i) => {
      const supplied = typeof callerParams[i] === "string" ? callerParams[i].trim() : "";
      if (supplied !== "") return supplied.slice(0, 400);
      if (/^\d+$/.test(v)) return ""; // unfilled numeric placeholder — no safe default
      return renderTemplate(`{{${v}}}`, leadCtx);
    });
    return waSendTemplate(to, t.name, t.language, positionals, contextWaMessageId);
  })();

  const message = await db.message.create({
    data: {
      conversationId: id,
      senderId: user.id,
      direction: "outbound",
      kind,
      body: messageBody,
      mediaUrl: mediaId,
      templateId,
      metaJson: mediaId ? JSON.stringify({ mediaId, filename, caption: kind === "audio" ? null : messageBody }) : body.replyToMessageId ? JSON.stringify({ replyToMessageId: String(body.replyToMessageId) }) : null,
      waMessageId: result.ok ? result.waMessageId : null,
      status: result.ok ? "sent" : "failed",
      errorCode: result.ok ? null : String(result.errorCode ?? ""),
      errorMessage: result.ok ? null : result.error,
      statusAt: new Date(),
    },
  });

  const preview = messageBody.slice(0, 120);
  await db.conversation.update({
    where: { id },
    data: { lastMessageAt: new Date(), lastMessagePreview: preview },
  });
  await db.lead.update({ where: { id: lead.id }, data: { lastContactAt: new Date() } });

  await logActivity({
    leadId: lead.id,
    actorId: user.id,
    type: "message_sent",
    title: result.ok ? `WhatsApp message sent to ${to}.` : `WhatsApp send FAILED to ${to} — ${result.error}`,
    meta: { messageId: message.id, status: message.status },
  });
  emitToSocket("message", { conversationId: id, message });

  // Meta's 24h customer-service window: free-form text is only deliverable
  // while it is open (opened by the customer's last inbound message). The DB
  // estimate can go stale (inbound webhook gaps), so Meta itself is the
  // source of truth:
  //   • a free-form send Meta ACCEPTS proves the window is open right now →
  //     stamp a conservative 60-minute horizon so the UI stops showing the
  //     "templates only" strip (a later 131047 clears it again);
  //   • a 131047 rejection proves it is closed → clear the stale window and
  //     tell the UI (hint) so the composer offers approved templates.
  const windowClosed = !result.ok && kind === "text" &&
    (String(result.errorCode ?? "") === "131047" || /131047|24 hour|re-engage|service window/i.test(result.error || ""));

  if (kind === "text") {
    await db.conversation.update({
      where: { id },
      data: result.ok
        ? { waServiceWindowUntil: new Date(Date.now() + 60 * 60 * 1000) }
        : (windowClosed ? { waServiceWindowUntil: null } : {}),
    });
  }

  if (!result.ok) {
    return Response.json(
      {
        error: `Provider rejected the message: ${result.error}`,
        providerError: true,
        ...(windowClosed ? { hint: "window_closed", errorCode: String(result.errorCode ?? "") } : {}),
        message,
      },
      { status: 502 }
    );
  }
  return Response.json({ ok: true, message });
}
