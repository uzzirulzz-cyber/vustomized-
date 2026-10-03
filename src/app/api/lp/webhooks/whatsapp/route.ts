import { db } from "@/lib/db";
import { getWhatsAppConfig } from "@/lib/lp/whatsapp";
import { getFacebookConfig } from "@/lib/lp/facebook";
import { logActivity } from "@/lib/lp/activity";
import { emitToSocket } from "@/lib/lp/socket";
import { normalizePhone } from "@/lib/lp/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Meta webhook (spec §4 + §10) — Meta server-to-server. No user auth;
// verified via hub.verify_token (GET) and processed IDEMPOTENTLY (POST):
// every inbound message is de-duplicated by its provider message id, so Meta
// retries never create duplicate bubbles.
//
// Handles BOTH Meta webhook objects on the same endpoint (spec §6 unified
// inbox):
//   object=whatsapp_business_account → WhatsApp Cloud API messages/statuses
//   object=page                      → Facebook Messenger messages/statuses
//
// Meta Webhook
//   ↓ this controller (verification + normalization)
//   ↓ MongoDB (WebhookEvent raw + Message normalized)
//   ↓ socket emit (sandbox) / cursor polling (serverless)
//   ↓ Agent Inbox
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token) {
    const [waCfg, fbCfg] = await Promise.all([getWhatsAppConfig(), getFacebookConfig()]);
    if (token === waCfg.webhookVerifyToken || token === fbCfg.webhookVerifyToken) {
      return new Response(challenge || "", { status: 200 });
    }
  }
  return Response.json({ error: "verification failed" }, { status: 403 });
}

type WaInboundMessage = {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string; payload?: string };
  interactive?: {
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };
  image?: { id?: string; caption?: string; mime_type?: string; sha256?: string };
  document?: { id?: string; filename?: string; caption?: string; mime_type?: string; sha256?: string };
  audio?: { id?: string; mime_type?: string; sha256?: string };
  video?: { id?: string; caption?: string; mime_type?: string; sha256?: string };
  sticker?: { id?: string; mime_type?: string };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  contacts?: { name?: { formatted_name?: string }; phones?: { phone?: string; type?: string }[] }[];
  reaction?: { message_id?: string; emoji?: string };
  order?: { catalog_id?: string; text?: string; product_items?: { product_retailer_id?: string; quantity?: number; item_price?: number }[] };
  system?: { body?: string; new_wa_id?: string };
  context?: { id?: string };
};

type WaWebhookBody = {
  entry?: {
    changes?: {
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: [{ wa_id?: string; profile?: { name?: string } }];
        messages?: WaInboundMessage[];
        statuses?: {
          id?: string;
          status?: string;
          timestamp?: string;
          recipient_id?: string;
          errors?: { code?: number; title?: string; message?: string }[];
        }[];
      };
    }[];
  }[];
};

const STOP_RE = /^(stop|unsubscribe|optout|opt out|opt-out|cancel|remove me|ارفض|توقف)$/i;

/** Normalize an inbound message into { kind, body, mediaId, meta } —
 *  everything the timeline needs to render it truthfully. */
function normalizeInbound(msg: WaInboundMessage): { kind: string; body: string; mediaId: string | null; meta: Record<string, unknown> } {
  const meta: Record<string, unknown> = {};
  if (msg.context?.id) meta.replyToWaMessageId = msg.context.id;

  switch (msg.type) {
    case "text":
      return { kind: "text", body: msg.text?.body || "", mediaId: null, meta };
    case "button":
      return { kind: "text", body: msg.button?.text || "[button]", mediaId: null, meta };
    case "interactive": {
      const t = msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || "[interactive reply]";
      if (msg.interactive?.button_reply?.id) meta.interactiveId = msg.interactive.button_reply.id;
      if (msg.interactive?.list_reply?.id) meta.interactiveId = msg.interactive.list_reply.id;
      return { kind: "interactive", body: t, mediaId: null, meta };
    }
    case "image":
      meta.mimeType = msg.image?.mime_type; meta.caption = msg.image?.caption;
      return { kind: "image", body: msg.image?.caption || "📷 Photo", mediaId: msg.image?.id || null, meta };
    case "document":
      meta.mimeType = msg.document?.mime_type; meta.filename = msg.document?.filename; meta.caption = msg.document?.caption;
      return { kind: "document", body: msg.document?.caption || msg.document?.filename || "📄 Document", mediaId: msg.document?.id || null, meta };
    case "audio":
      meta.mimeType = msg.audio?.mime_type;
      return { kind: "audio", body: "🎙️ Voice message", mediaId: msg.audio?.id || null, meta };
    case "video":
      meta.mimeType = msg.video?.mime_type; meta.caption = msg.video?.caption;
      return { kind: "video", body: msg.video?.caption || "🎬 Video", mediaId: msg.video?.id || null, meta };
    case "sticker":
      meta.mimeType = msg.sticker?.mime_type;
      return { kind: "sticker", body: "Sticker", mediaId: msg.sticker?.id || null, meta };
    case "location": {
      const bits = [msg.location?.name, msg.location?.address].filter(Boolean).join(" — ");
      meta.latitude = msg.location?.latitude; meta.longitude = msg.location?.longitude;
      return { kind: "location", body: `📍 Location${bits ? `: ${bits}` : ""} (${msg.location?.latitude ?? "?"}, ${msg.location?.longitude ?? "?"})`, mediaId: null, meta };
    }
    case "contacts": {
      const c = msg.contacts?.[0];
      const name = c?.name?.formatted_name || "contact";
      const phone = c?.phones?.[0]?.phone || "";
      meta.sharedContactName = name; meta.sharedContactPhone = phone;
      return { kind: "contacts", body: `👤 Contact: ${name}${phone ? ` · ${phone}` : ""}`, mediaId: null, meta };
    }
    case "reaction":
      meta.reactsToWaMessageId = msg.reaction?.message_id;
      return { kind: "reaction", body: msg.reaction?.emoji || "👍", mediaId: null, meta };
    case "order":
      meta.order = msg.order;
      return { kind: "order", body: msg.order?.text || `🛒 Order (${msg.order?.product_items?.length ?? 0} items)`, mediaId: null, meta };
    case "system":
      return { kind: "system", body: msg.system?.body || "System message", mediaId: null, meta };
    default:
      return { kind: "unsupported", body: `[${msg.type || "unknown"} message]`, mediaId: null, meta };
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as WaWebhookBody & { object?: string };
  const object = body.object || "whatsapp_business_account";

  // Facebook Page (Messenger) events share this endpoint (spec §6/§13/§14).
  if (object === "page") return handleMessenger(body as unknown as FbWebhookBody);

  await db.webhookEvent.create({
    data: { provider: "whatsapp", kind: "payload", payloadJson: JSON.stringify(body).slice(0, 20000), processed: true },
  });

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};

      // ---- Delivery/read/failed status updates ----
      for (const st of value.statuses || []) {
        if (!st.id) continue;
        const status = st.status; // sent | delivered | read | failed | deleted
        const patch: Record<string, unknown> = { status, statusAt: new Date() };
        if (status === "failed" && st.errors?.[0]) {
          patch.errorCode = String(st.errors[0].code ?? "");
          patch.errorMessage = st.errors[0].message || st.errors[0].title || "delivery failed";
        }
        await db.message.updateMany({ where: { waMessageId: st.id }, data: patch });

        // campaign recipient status propagation
        const recipient = await db.campaignRecipient.findFirst({ where: { waMessageId: st.id } });
        if (recipient && status) {
          const map: Record<string, string> = { sent: "sent", delivered: "delivered", read: "read", failed: "failed" };
          if (map[status]) {
            await db.campaignRecipient.update({
              where: { id: recipient.id },
              data: { status: map[status], error: status === "failed" ? (patch.errorMessage as string) : null },
            });
          }
        }
        await db.webhookEvent.create({
          data: { provider: "whatsapp", kind: "status", payloadJson: JSON.stringify(st).slice(0, 5000), processed: true },
        });
      }

      // ---- Inbound messages ----
      for (const msg of value.messages || []) {
        const from = msg.from ? `+${msg.from.replace(/\D/g, "")}` : null;
        if (!from) continue;

        // ── IDEMPOTENCY: Meta redelivers webhooks; skip anything already stored ──
        if (msg.id) {
          const dupe = await db.message.findFirst({ where: { waMessageId: msg.id }, select: { id: true } });
          if (dupe) continue;
        }

        const norm = normalizeInbound(msg);
        const waPhone = normalizePhone(from).e164 || from;
        const waNorm = waPhone.replace(/\D/g, "");

        let lead =
          (await db.lead.findFirst({ where: { whatsappNorm: waNorm } })) ||
          (await db.lead.findFirst({ where: { phoneNorm: waNorm } }));

        if (!lead) {
          // Unknown sender — create a webhook-sourced lead so nothing is lost,
          // then fall through to open a conversation for them.
          const profileName = value.contacts?.[0]?.profile?.name || "";
          const [firstName, ...rest] = profileName.split(" ");
          lead = await db.lead.create({
            data: {
              firstName: firstName || null,
              lastName: rest.join(" ") || null,
              whatsapp: waPhone,
              whatsappNorm: waNorm,
              phone: waPhone,
              phoneNorm: waNorm,
              source: "webhook",
              status: "new",
            },
          });
          await logActivity({ leadId: lead.id, type: "lead_created", title: `Lead auto-created from inbound WhatsApp (${waPhone}).` });
        }

        // ---- STOP keyword → suppression list (compliance §15) ----
        if (STOP_RE.test(norm.body.trim()) && norm.kind === "text") {
          await db.optOut.upsert({
            where: { channel_value: { channel: "whatsapp", value: waNorm } },
            create: { channel: "whatsapp", value: waNorm, reason: "stop_keyword", source: "webhook", leadId: lead.id },
            update: { optBackInAt: null, optedOutAt: new Date() },
          });
          await db.lead.update({ where: { id: lead.id }, data: { optedOut: true, optedOutAt: new Date(), status: "do_not_contact" } });
          await logActivity({ leadId: lead.id, type: "opt_out", title: `Customer replied "${norm.body.trim()}" — OPTED OUT, suppressed from all campaigns.` });
          continue;
        }

        // ---- Normal inbound → conversation ----
        let conversation = await db.conversation.findFirst({
          where: { leadId: lead.id, channel: "whatsapp", status: { not: "closed" } },
        });
        if (!conversation) {
          conversation = await db.conversation.create({
            data: { leadId: lead.id, channel: "whatsapp", waPhone, assignedToId: lead.assignedToId },
          });
          await logActivity({ leadId: lead.id, type: "conversation_started", title: `WhatsApp conversation started (inbound from ${waPhone}).` });
        }

        const message = await db.message.create({
          data: {
            conversationId: conversation.id,
            direction: "inbound",
            kind: norm.kind,
            body: norm.body,
            mediaUrl: norm.mediaId,
            metaJson: Object.keys(norm.meta).length ? JSON.stringify(norm.meta) : null,
            waMessageId: msg.id || null,
            status: "delivered",
            statusAt: new Date(),
          },
        });

        // Inbound reply counts as a "reply" for campaign recipients of this lead
        await db.campaignRecipient.updateMany({
          where: { leadId: lead.id, status: { in: ["sent", "delivered", "read"] } },
          data: { status: "replied" },
        });

        // 24h service window opens on inbound
        const until = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await db.conversation.update({
          where: { id: conversation.id },
          data: {
            lastMessageAt: new Date(),
            lastMessagePreview: norm.body.slice(0, 120),
            unreadCount: { increment: 1 },
            waServiceWindowUntil: until,
          },
        });
        await db.lead.update({ where: { id: lead.id }, data: { lastContactAt: new Date(), status: lead.status === "new" ? "contacted" : lead.status } });
        await logActivity({ leadId: lead.id, type: "message_received", title: `Customer replied: "${norm.body.slice(0, 80)}"` });
        emitToSocket("message", { conversationId: conversation.id, message, leadId: lead.id });

        await db.webhookEvent.create({
          data: { provider: "whatsapp", kind: "message", payloadJson: JSON.stringify({ id: msg.id, type: msg.type, from }).slice(0, 5000), processed: true },
        });
      }
    }
  }

  return Response.json({ success: true });
}

// ─── Facebook Page / Messenger (spec §13/§14) ────────────────────────────────

type FbAttachment = {
  type?: string; // image | video | audio | file | fallback | template
  payload?: { url?: string; attachment_id?: string; title?: string; coordinates?: { lat?: number; long?: number } };
};

type FbMessagingEvent = {
  sender?: { id?: string }; // PSID for user-sent events
  recipient?: { id?: string }; // page id
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    is_deleted?: boolean;
    attachments?: FbAttachment[];
    reply_to?: { mid?: string };
  };
  postback?: { title?: string; payload?: string };
  read?: { watermark?: number };
  delivery?: { mids?: string[]; watermark?: number };
  message_echo?: FbMessagingEvent["message"];
};

type FbWebhookBody = {
  object?: string;
  entry?: {
    id?: string; // page id
    time?: number;
    messaging?: FbMessagingEvent[];
    changes?: { field?: string; value?: Record<string, unknown> }[]; // feed/comments — logged only (spec §15 later)
  }[];
};

function normalizeMessenger(msg: NonNullable<FbMessagingEvent["message"]>): { kind: string; body: string; mediaUrl: string | null; meta: Record<string, unknown> } {
  const meta: Record<string, unknown> = {};
  if (msg.reply_to?.mid) meta.replyToWaMessageId = msg.reply_to.mid;
  const att = msg.attachments?.[0];
  if (att) {
    meta.attachmentType = att.type;
    if (att.payload?.url) meta.attachmentUrl = att.payload.url;
    switch (att.type) {
      case "image": return { kind: "image", body: "📷 Photo", mediaUrl: att.payload?.url || null, meta };
      case "video": return { kind: "video", body: "🎬 Video", mediaUrl: att.payload?.url || null, meta };
      case "audio": return { kind: "audio", body: "🎙️ Voice message", mediaUrl: att.payload?.url || null, meta };
      case "file": return { kind: "document", body: att.payload?.title || "📄 File", mediaUrl: att.payload?.url || null, meta };
      default: return { kind: "unsupported", body: `[${att.type || "attachment"}]`, mediaUrl: att.payload?.url || null, meta };
    }
  }
  return { kind: "text", body: msg.text || "", mediaUrl: null, meta };
}

async function handleMessenger(body: FbWebhookBody): Promise<Response> {
  await db.webhookEvent.create({
    data: { provider: "facebook", kind: "payload", payloadJson: JSON.stringify(body).slice(0, 20000), processed: true },
  });

  for (const entry of body.entry || []) {
    // Feed events (comments/posts, spec §15) are logged raw for now — the
    // Messenger inbox is the module that ships in this milestone.
    for (const change of entry.changes || []) {
      await db.webhookEvent.create({
        data: { provider: "facebook", kind: change.field || "change", payloadJson: JSON.stringify(change.value || {}).slice(0, 10000), processed: false },
      });
    }

    for (const ev of entry.messaging || []) {
      const psid = ev.sender?.id || null;
      const pageId = ev.recipient?.id || entry.id || null;
      if (!psid) continue;

      // ---- Read receipts / delivery confirmations for our outbound ----
      if (ev.read?.watermark) {
        await db.message.updateMany({
          where: { conversation: { channel: "facebook", fbPsid: psid }, direction: "outbound", status: { in: ["sent", "delivered"] } },
          data: { status: "read", statusAt: new Date() },
        });
        await db.webhookEvent.create({ data: { provider: "facebook", kind: "read", payloadJson: JSON.stringify(ev).slice(0, 2000), processed: true } });
        continue;
      }
      if (ev.delivery) {
        const mids = ev.delivery.mids || [];
        if (mids.length) {
          for (const mid of mids) {
            await db.message.updateMany({ where: { waMessageId: mid, status: "sent" }, data: { status: "delivered", statusAt: new Date() } });
          }
        } else if (ev.delivery.watermark) {
          await db.message.updateMany({
            where: { conversation: { channel: "facebook", fbPsid: psid }, direction: "outbound", status: "sent" },
            data: { status: "delivered", statusAt: new Date() },
          });
        }
        await db.webhookEvent.create({ data: { provider: "facebook", kind: "delivery", payloadJson: JSON.stringify(ev).slice(0, 2000), processed: true } });
        continue;
      }

      // ---- Echoes of our own sends (send API already recorded them) ----
      if (ev.message?.is_echo) {
        if (ev.message.mid) {
          const exists = await db.message.findFirst({ where: { waMessageId: ev.message.mid }, select: { id: true } });
          if (!exists) {
            const norm = normalizeMessenger(ev.message);
            const conv = await db.conversation.findFirst({ where: { channel: "facebook", fbPsid: psid, status: { not: "closed" } } });
            if (conv) {
              await db.message.create({
                data: {
                  conversationId: conv.id, direction: "outbound", kind: norm.kind, body: norm.body,
                  mediaUrl: norm.mediaUrl, waMessageId: ev.message.mid, status: "sent", statusAt: new Date(),
                  metaJson: Object.keys(norm.meta).length ? JSON.stringify(norm.meta) : null,
                },
              });
            }
          }
        }
        continue;
      }

      // ---- Inbound message or postback ----
      const isPostback = Boolean(ev.postback);
      const mid = ev.message?.mid || `postback_${ev.timestamp || Date.now()}_${psid}`;
      // ── IDEMPOTENCY: Meta redelivers webhooks; skip anything already stored ──
      const dupe = await db.message.findFirst({ where: { waMessageId: mid }, select: { id: true } });
      if (dupe) continue;

      const norm = isPostback
        ? { kind: "interactive", body: ev.postback?.title || ev.postback?.payload || "[postback]", mediaUrl: null, meta: { postbackPayload: ev.postback?.payload } as Record<string, unknown> }
        : normalizeMessenger(ev.message || {});
      if (!isPostback && !ev.message) continue; // neither message nor postback — nothing actionable

      let lead = await db.lead.findFirst({ where: { fbPsid: psid } });
      if (!lead) {
        lead = await db.lead.create({
          data: {
            fbPsid: psid,
            source: "webhook",
            status: "new",
          },
        });
        await logActivity({ leadId: lead.id, type: "lead_created", title: `Lead auto-created from inbound Facebook Messenger (PSID ${psid}).` });
      }

      // ---- STOP keyword → suppression list (compliance §15) ----
      if (!isPostback && norm.kind === "text" && STOP_RE.test(norm.body.trim())) {
        await db.optOut.upsert({
          where: { channel_value: { channel: "facebook", value: psid } },
          create: { channel: "facebook", value: psid, reason: "stop_keyword", source: "webhook", leadId: lead.id },
          update: { optBackInAt: null, optedOutAt: new Date() },
        });
        await db.lead.update({ where: { id: lead.id }, data: { optedOut: true, optedOutAt: new Date(), status: "do_not_contact" } });
        await logActivity({ leadId: lead.id, type: "opt_out", title: `Customer replied "${norm.body.trim()}" on Messenger — OPTED OUT, suppressed from all campaigns.` });
        continue;
      }

      let conversation = await db.conversation.findFirst({
        where: { leadId: lead.id, channel: "facebook", status: { not: "closed" } },
      });
      if (!conversation) {
        conversation = await db.conversation.create({
          data: { leadId: lead.id, channel: "facebook", fbPsid: psid, assignedToId: lead.assignedToId },
        });
        await logActivity({ leadId: lead.id, type: "conversation_started", title: `Facebook Messenger conversation started (page ${pageId || "unknown"}).` });
      }

      const message = await db.message.create({
        data: {
          conversationId: conversation.id,
          direction: "inbound",
          kind: norm.kind,
          body: norm.body,
          mediaUrl: norm.mediaUrl,
          metaJson: Object.keys(norm.meta).length ? JSON.stringify(norm.meta) : null,
          waMessageId: mid,
          status: "delivered",
          statusAt: new Date(),
        },
      });

      // Inbound reply counts as a "reply" for campaign recipients of this lead
      await db.campaignRecipient.updateMany({
        where: { leadId: lead.id, status: { in: ["sent", "delivered", "read"] } },
        data: { status: "replied" },
      });

      // Messenger 24h standard messaging window opens on inbound (estimate only —
      // Meta's own send rejection is the source of truth, surfaced verbatim).
      const until = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await db.conversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: new Date(),
          lastMessagePreview: norm.body.slice(0, 120),
          unreadCount: { increment: 1 },
          waServiceWindowUntil: until,
        },
      });
      await db.lead.update({ where: { id: lead.id }, data: { lastContactAt: new Date(), status: lead.status === "new" ? "contacted" : lead.status } });
      await logActivity({ leadId: lead.id, type: "message_received", title: `Messenger reply: "${norm.body.slice(0, 80)}"` });
      emitToSocket("message", { conversationId: conversation.id, message, leadId: lead.id });

      await db.webhookEvent.create({
        data: { provider: "facebook", kind: isPostback ? "postback" : "message", payloadJson: JSON.stringify({ mid, psid, pageId }).slice(0, 5000), processed: true },
      });
    }
  }

  return Response.json({ success: true });
}
