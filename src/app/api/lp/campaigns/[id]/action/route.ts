import { db } from "@/lib/db";
import { getAuthUser, can, jsonError } from "@/lib/lp/auth";
import { logAudit } from "@/lib/lp/activity";
import { getWhatsAppConfig } from "@/lib/lp/whatsapp";
import { renderTemplate } from "@/lib/lp/render";

// POST { action: "launch" | "pause" | "resume" | "cancel" }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "campaigns.manage")) return jsonError("Unauthorized", 401);
  const { id } = await params;
  const { action } = await req.json().catch(() => ({}));

  const campaign = await db.campaign.findUnique({ where: { id }, include: { template: true } });
  if (!campaign) return jsonError("Campaign not found", 404);

  if (action === "launch" || action === "resume") {
    const cfg = await getWhatsAppConfig();
    if (!cfg.connected) {
      return jsonError("WhatsApp provider not connected — connect it under Integrations before launching a campaign.", 409);
    }
    if (campaign.templateId && campaign.template?.kind === "whatsapp_template" && campaign.template.approvalStatus !== "meta_approved") {
      return jsonError(
        `The selected template "${campaign.template?.name}" is not Meta-approved (status: ${campaign.template?.approvalStatus}). Business-initiated campaigns MUST use Meta-approved templates (WhatsApp policy §15).`,
        409
      );
    }

    if (action === "launch") {
      // Build audience from the saved filter
      const audience = campaign.audienceJson ? JSON.parse(campaign.audienceJson) : {};
      const where: Record<string, unknown> = {};
      if (audience.status) where.status = audience.status;
      if (audience.country) where.country = audience.country;
      if (audience.industry) where.industry = audience.industry;
      if (audience.assignedToId) where.assignedToId = audience.assignedToId;
      if (audience.tag) where.tags = { contains: `"${audience.tag}"` };
      if (Array.isArray(audience.leadIds) && audience.leadIds.length) where.id = { in: audience.leadIds };

      const leads = await db.lead.findMany({ where, include: { assignedTo: { select: { name: true } } } });

      // wipe any previous queue, rebuild with compliance exclusions
      await db.campaignRecipient.deleteMany({ where: { campaignId: id } });
      const sender = campaign.senderId ? await db.user.findUnique({ where: { id: campaign.senderId } }) : null;
      let excludedOptOut = 0;
      let excludedInvalid = 0;
      const rows: {
        campaignId: string; leadId: string; status: string; renderedBody?: string; error?: string;
      }[] = [];
      for (const lead of leads) {
        const to = lead.whatsapp;
        const rendered = campaign.template
          ? renderTemplate(campaign.template.bodyText, {
              firstName: lead.firstName, lastName: lead.lastName, company: lead.company,
              country: lead.country, city: lead.city, employeeName: sender?.name || "PlayBeat Team",
              phone: lead.phone, email: lead.email,
            })
          : campaign.bodyText || "";
        if (lead.optedOut || !to) {
          if (lead.optedOut) { rows.push({ campaignId: id, leadId: lead.id, status: "excluded_optout", error: "Opted out / on suppression list" }); excludedOptOut++; }
          else { rows.push({ campaignId: id, leadId: lead.id, status: "excluded_invalid", error: "No WhatsApp number" }); excludedInvalid++; }
          continue;
        }
        rows.push({ campaignId: id, leadId: lead.id, status: "queued", renderedBody: rendered });
      }
      if (rows.length) await db.campaignRecipient.createMany({ data: rows });

      await db.campaign.update({
        where: { id },
        data: { status: "running", launchedAt: new Date(), completedAt: null },
      });
      await logAudit({
        actorId: user.id, actorName: user.name, action: "campaign.launch",
        entity: "campaign", entityId: id,
        detail: `audience=${leads.length} queued=${rows.length - excludedOptOut - excludedInvalid} excluded_optout=${excludedOptOut} excluded_invalid=${excludedInvalid}`,
      });
      return Response.json({
        ok: true,
        status: "running",
        audience: leads.length,
        queued: rows.length - excludedOptOut - excludedInvalid,
        excludedOptOut,
        excludedInvalid,
      });
    }
    // resume
    await db.campaign.update({ where: { id }, data: { status: "running" } });
    return Response.json({ ok: true, status: "running" });
  }

  if (action === "pause") {
    await db.campaign.update({ where: { id }, data: { status: "paused" } });
    await logAudit({ actorId: user.id, actorName: user.name, action: "campaign.pause", entity: "campaign", entityId: id });
    return Response.json({ ok: true, status: "paused" });
  }

  if (action === "cancel") {
    await db.campaign.update({ where: { id }, data: { status: "cancelled", completedAt: new Date() } });
    await db.campaignRecipient.updateMany({ where: { campaignId: id, status: "queued" }, data: { status: "failed", error: "Campaign cancelled" } });
    await logAudit({ actorId: user.id, actorName: user.name, action: "campaign.cancel", entity: "campaign", entityId: id });
    return Response.json({ ok: true, status: "cancelled" });
  }

  return jsonError(`Unknown action "${action}"`, 400);
}
