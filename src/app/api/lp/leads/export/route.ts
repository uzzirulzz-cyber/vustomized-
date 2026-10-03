import { db } from "@/lib/db";
import { getAuthUser, can, jsonError } from "@/lib/lp/auth";

// CSV export honoring current filters (spec §3).
export async function GET(req: Request) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "leads.read")) return jsonError("Unauthorized", 401);

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() || "";
  const status = url.searchParams.get("status") || "";
  const country = url.searchParams.get("country") || "";
  const assignedTo = url.searchParams.get("assignedTo") || "";

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (country) where.country = country;
  if (assignedTo === "me") where.assignedToId = user.id;
  else if (assignedTo) where.assignedToId = assignedTo;
  if (q) {
    where.OR = [
      { firstName: { contains: q } },
      { lastName: { contains: q } },
      { company: { contains: q } },
      { email: { contains: q } },
      { whatsapp: { contains: q } },
      { phone: { contains: q } },
    ];
  }

  const leads = await db.lead.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 10000,
    include: { assignedTo: { select: { name: true } } },
  });

  const header = "first_name,last_name,company,job_title,country,state,city,website,email,whatsapp,phone,industry,lead_source,lead_status,lead_score,tags,assigned_employee,opted_out,created_at";
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = leads.map((l) =>
    [
      l.firstName, l.lastName, l.company, l.jobTitle, l.country, l.state, l.city, l.website,
      l.email, l.whatsapp, l.phone, l.industry, l.source, l.status, l.score,
      JSON.parse(l.tags || "[]").join(";"),
      l.assignedTo?.name || "", l.optedOut ? "yes" : "no", l.createdAt.toISOString(),
    ].map(esc).join(",")
  );
  const csv = [header, ...lines].join("\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leadpulse-export-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
