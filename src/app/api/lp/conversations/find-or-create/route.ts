import { db } from "@/lib/db";
import { getAuthUser, can, jsonError } from "@/lib/lp/auth";
import { normalizePhone } from "@/lib/lp/csv";
import type { Lead } from "@prisma/client";

// POST { leadId } OR { phone, name? } → the contact's open WhatsApp
// conversation (created on first use).
//
// The Dialer keypad dials ARBITRARY numbers: when only `phone` is given, the
// matching lead is found by normalized digits (whatsappNorm/phoneNorm) or a
// new "dialer"-sourced lead is created — nothing leaves the CRM. The message
// box then sends through the WhatsApp Cloud API via the send endpoint.
export async function POST(req: Request) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "conversations.send")) return jsonError("Unauthorized", 401);
  const body = await req.json().catch(() => ({}));

  let lead: Lead | null = null;

  if (body.leadId) {
    lead = await db.lead.findUnique({ where: { id: String(body.leadId) } });
    if (!lead) return jsonError("Lead not found", 404);
    if (!lead.whatsapp) return jsonError("This lead has no WhatsApp number.", 400);
  } else if (body.phone) {
    const raw = String(body.phone).trim();
    const norm = normalizePhone(raw.startsWith("+") ? raw : `+${raw.replace(/\D/g, "")}`);
    const e164 = norm.e164 || `+${raw.replace(/\D/g, "")}`;
    const digits = e164.replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) {
      return jsonError("Enter a valid number with country code (8–15 digits).", 400);
    }

    lead =
      (await db.lead.findFirst({ where: { whatsappNorm: digits } })) ||
      (await db.lead.findFirst({ where: { phoneNorm: digits } }));

    if (!lead) {
      // Dialed a number that is not in the CRM yet — create the contact
      // internally so the conversation (and its history) has an owner.
      const name = String(body.name || "").trim();
      const [firstName, ...rest] = name ? name.split(" ") : [];
      lead = await db.lead.create({
        data: {
          firstName: firstName || null,
          lastName: rest.join(" ") || null,
          whatsapp: e164,
          whatsappNorm: digits,
          phone: e164,
          phoneNorm: digits,
          country: norm.country || null,
          source: "dialer",
          status: "new",
        },
      });
    }
    if (!lead.whatsapp && lead.phone) {
      lead = await db.lead.update({ where: { id: lead.id }, data: { whatsapp: lead.phone } });
    }
  } else {
    return jsonError("leadId or phone required", 400);
  }

  if (!lead.whatsapp) return jsonError("This contact has no WhatsApp number.", 400);

  let conversation = await db.conversation.findFirst({
    where: { leadId: lead.id, channel: "whatsapp", status: "open" },
  });
  if (!conversation) {
    conversation = await db.conversation.create({
      data: { leadId: lead.id, channel: "whatsapp", waPhone: lead.whatsapp, assignedToId: lead.assignedToId },
    });
  }
  return Response.json({ conversation, lead });
}
