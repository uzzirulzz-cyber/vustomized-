import { db } from "@/lib/db";
import { getAuthUser, can, jsonError } from "@/lib/lp/auth";
import { logAudit } from "@/lib/lp/activity";

export async function GET(req: Request) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "compliance.manage")) return jsonError("Unauthorized", 401);
  const optouts = await db.optOut.findMany({
    orderBy: { optedOutAt: "desc" },
    take: 500,
  });
  // resolve lead references manually (portable across Prisma client versions)
  const leadIds = [...new Set(optouts.map((o) => o.leadId).filter(Boolean) as string[])];
  const leads = leadIds.length
    ? await db.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, firstName: true, lastName: true, company: true } })
    : [];
  const leadMap = new Map(leads.map((l) => [l.id, l]));
  return Response.json({
    optouts: optouts.map((o) => ({ ...o, lead: o.leadId ? leadMap.get(o.leadId) ?? null : null })),
  });
}

export async function POST(req: Request) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "compliance.manage")) return jsonError("Unauthorized", 401);
  const body = await req.json().catch(() => ({}));
  const channel = ["whatsapp", "phone", "email"].includes(body.channel) ? body.channel : "whatsapp";
  const value = String(body.value || "").replace(/\D/g, "") || String(body.value || "").trim().toLowerCase();
  if (!value) return jsonError("value required", 400);

  const optout = await db.optOut.upsert({
    where: { channel_value: { channel, value } },
    create: { channel, value, reason: body.reason || "manual", source: "manual", leadId: body.leadId || null },
    update: { optBackInAt: null, reason: body.reason || "manual" },
  });

  if (body.leadId) {
    await db.lead.update({ where: { id: body.leadId }, data: { optedOut: true, optedOutAt: new Date(), status: "do_not_contact" } });
    await logAudit({ actorId: user.id, actorName: user.name, action: "compliance.optout.add", detail: `${channel}:${value.slice(0, 6)}…` });
  }
  await logAudit({ actorId: user.id, actorName: user.name, action: "compliance.optout.add", detail: `${channel}:${value.slice(0, 6)}…` });
  return Response.json({ optout }, { status: 201 });
}

// Explicit opt-BACK-IN only (spec §15)
export async function DELETE(req: Request) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "compliance.manage")) return jsonError("Unauthorized", 401);
  const { id } = await req.json().catch(() => ({}));
  const optout = await db.optOut.update({ where: { id }, data: { optBackInAt: new Date() } });
  if (optout.leadId) {
    await db.lead.update({ where: { id: optout.leadId }, data: { optedOut: false, optedOutAt: null, status: "contacted" } }).catch(() => null);
  }
  await logAudit({ actorId: user.id, actorName: user.name, action: "compliance.optin", detail: optout.value.slice(0, 6) + "…" });
  return Response.json({ ok: true });
}
