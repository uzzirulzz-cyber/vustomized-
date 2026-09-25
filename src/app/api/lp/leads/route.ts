import { db } from "@/lib/db";
import { getAuthUser, can, jsonError } from "@/lib/lp/auth";
import { logActivity, logAudit } from "@/lib/lp/activity";
import { normalizePhone } from "@/lib/lp/csv";

export async function GET(req: Request) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "leads.read")) return jsonError("Unauthorized", 401);

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() || "";
  const status = url.searchParams.get("status") || "";
  const country = url.searchParams.get("country") || "";
  const industry = url.searchParams.get("industry") || "";
  const assignedTo = url.searchParams.get("assignedTo") || "";
  const tag = url.searchParams.get("tag") || "";
  const source = url.searchParams.get("source") || "";
  const minScore = url.searchParams.get("minScore");
  const hasWhatsapp = url.searchParams.get("hasWhatsapp") === "1";
  const hasEmail = url.searchParams.get("hasEmail") === "1";
  const optedOut = url.searchParams.get("optedOut");
  const sort = url.searchParams.get("sort") || "createdAt";
  const order = url.searchParams.get("order") === "asc" ? "asc" : "desc";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(5, parseInt(url.searchParams.get("pageSize") || "25", 10)));

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (country) where.country = country;
  if (industry) where.industry = industry;
  if (assignedTo === "me") where.assignedToId = user.id;
  else if (assignedTo) where.assignedToId = assignedTo;
  if (source) where.source = source;
  if (hasWhatsapp) where.whatsappNorm = { not: null };
  if (hasEmail) where.email = { not: null };
  if (optedOut === "1") where.optedOut = true;
  if (optedOut === "0") where.optedOut = false;
  if (minScore) where.score = { gte: parseInt(minScore, 10) || 0 };
  if (tag) where.tags = { contains: `"${tag}"` };
  if (q) {
    where.OR = [
      { firstName: { contains: q } },
      { lastName: { contains: q } },
      { company: { contains: q } },
      { email: { contains: q } },
      { whatsapp: { contains: q } },
      { phone: { contains: q } },
      { city: { contains: q } },
      { jobTitle: { contains: q } },
    ];
  }

  const sortable = ["createdAt", "lastContactAt", "score", "firstName", "company", "status"];
  const orderBy: Record<string, "asc" | "desc"> = {
    [sortable.includes(sort) ? sort : "createdAt"]: order,
  };

  const [total, leads] = await Promise.all([
    db.lead.count({ where }),
    db.lead.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { assignedTo: { select: { id: true, name: true } } },
    }),
  ]);

  return Response.json({ total, page, pageSize, leads });
}

export async function POST(req: Request) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "leads.write")) return jsonError("Unauthorized", 401);
  const body = await req.json().catch(() => ({}));

  const wa = normalizePhone(body.whatsapp || "");
  const ph = normalizePhone(body.phone || "");
  if (!wa.e164 && !ph.e164 && !body.email) {
    return jsonError("At least one contact channel is required (WhatsApp, phone or email).", 400);
  }

  const lead = await db.lead.create({
    data: {
      firstName: body.firstName || null,
      lastName: body.lastName || null,
      company: body.company || null,
      jobTitle: body.jobTitle || null,
      country: body.country || wa.country || ph.country || null,
      state: body.state || null,
      city: body.city || null,
      address: body.address || null,
      website: body.website || null,
      email: body.email ? String(body.email).toLowerCase().trim() : null,
      emailStatus: body.email ? "valid" : "unknown",
      whatsapp: wa.e164,
      whatsappNorm: wa.e164?.replace(/\D/g, "") ?? null,
      phone: ph.e164 || wa.e164,
      phoneNorm: (ph.e164 || wa.e164)?.replace(/\D/g, "") ?? null,
      industry: body.industry || null,
      source: "manual",
      status: body.status || "new",
      score: Math.max(0, Math.min(100, parseInt(body.score, 10) || 0)),
      tags: JSON.stringify(Array.isArray(body.tags) ? body.tags : []),
      assignedToId: body.assignedToId || null,
    },
  });
  await logActivity({
    leadId: lead.id,
    actorId: user.id,
    type: "lead_created",
    title: "Lead created manually.",
  });
  await logAudit({ actorId: user.id, actorName: user.name, action: "lead.create", entity: "lead", entityId: lead.id });
  return Response.json({ lead }, { status: 201 });
}
