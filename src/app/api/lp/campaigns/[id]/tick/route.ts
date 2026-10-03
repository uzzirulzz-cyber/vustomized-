import { db } from "@/lib/db";
import { getAuthUser, can, jsonError } from "@/lib/lp/auth";
import { getWhatsAppConfig, waSendTemplate, waSendText } from "@/lib/lp/whatsapp";
import { logActivity } from "@/lib/lp/activity";
import { emitToSocket } from "@/lib/lp/socket";

// Process due campaign sends — throttled, honest, compliance-enforced.
// The SPA ticks this endpoint while a campaign is RUNNING (and on dashboard
// loads). Hard caps per tick to respect rate limits (spec §15: never bypass).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "campaigns.manage")) return jsonError("Unauthorized", 401);
  const { id } = await params;

  const campaign = await db.campaign.findUnique({ where: { id }, include: { template: true, sender: { select: { name: true } } } });
  if (!campaign) return jsonError("Campaign not found", 404);
  if (campaign.status !== "running") return Response.json({ ok: true, status: campaign.status, processed: 0 });

  const cfg = await getWhatsAppConfig();
  if (!cfg.connected) {
    await db.campaign.update({ where: { id }, data: { status: "paused" } });
    return Response.json({ ok: true, status: "paused", processed: 0, reason: "WhatsApp not connected" });
  }

  // Daily cap: count sends since UTC midnight
  const utcMidnight = new Date();
  utcMidnight.setUTCHours(0, 0, 0, 0);
  const sentToday = await db.campaignRecipient.count({
    where: { campaignId: id, sentAt: { gte: utcMidnight }, status: { in: ["sent", "delivered", "read", "replied"] } },
  });
  const budget = Math.max(0, campaign.dailyLimit - sentToday);
  if (budget === 0) {
    return Response.json({ ok: true, status: "running", processed: 0, reason: `Daily limit reached (${campaign.dailyLimit}/day) — resumes at UTC midnight.` });
  }

  const batch = await db.campaignRecipient.findMany({
    where: { campaignId: id, status: "queued" },
    orderBy: { createdAt: "asc" },
    take: Math.min(25, budget), // also respects min-interval via client tick pacing
    include: { lead: true },
  });

  let sent = 0;
  let failed = 0;
  for (const r of batch) {
    const lead = r.lead;
    // Re-check suppression at send time (an opt-out may have happened after queueing)
    if (lead.optedOut) {
      await db.campaignRecipient.update({ where: { id: r.id }, data: { status: "excluded_optout", error: "Opted out before send" } });
      continue;
    }
    const to = lead.whatsapp;
    if (!to) {
      await db.campaignRecipient.update({ where: { id: r.id }, data: { status: "excluded_invalid", error: "No WhatsApp number" } });
      continue;
    }

    const result = campaign.template
      ? await waSendTemplate(to, campaign.template.name, campaign.template.language, [])
      : await waSendText(to, r.renderedBody || "");

    if (result.ok) {
      await db.campaignRecipient.update({
        where: { id: r.id },
        data: { status: "sent", waMessageId: result.waMessageId, sentAt: new Date() },
      });
      await db.message.create({
        data: {
          conversationId: (await ensureConversation(lead.id, to)).id,
          senderId: user.id,
          direction: "outbound",
          kind: campaign.template ? "template" : "text",
          body: r.renderedBody || "",
          templateId: campaign.templateId,
          waMessageId: result.waMessageId,
          status: "sent",
          campaignId: campaign.id,
          statusAt: new Date(),
        },
      });
      await db.lead.update({ where: { id: lead.id }, data: { lastContactAt: new Date(), status: lead.status === "new" ? "contacted" : lead.status } });
      await logActivity({ leadId: lead.id, actorId: user.id, type: "campaign_sent", title: `Campaign "${campaign.name}" message sent to ${to}.` });
      sent++;
    } else {
      await db.campaignRecipient.update({
        where: { id: r.id },
        data: { status: "failed", error: result.error.slice(0, 300) },
      });
      failed++;
    }
  }

  // Complete?
  const remaining = await db.campaignRecipient.count({ where: { campaignId: id, status: "queued" } });
  if (remaining === 0) {
    await db.campaign.update({ where: { id }, data: { status: "completed", completedAt: new Date() } });
  }

  emitToSocket("campaign_progress", { campaignId: id, sent, failed, remaining });
  return Response.json({ ok: true, status: remaining === 0 ? "completed" : "running", processed: batch.length, sent, failed, remaining });
}

async function ensureConversation(leadId: string, waPhone: string) {
  let conv = await db.conversation.findFirst({ where: { leadId, channel: "whatsapp", status: "open" } });
  if (!conv) conv = await db.conversation.create({ data: { leadId, channel: "whatsapp", waPhone } });
  return conv;
}
