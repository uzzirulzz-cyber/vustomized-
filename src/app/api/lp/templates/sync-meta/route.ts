import { getAuthUser, can, jsonError } from "@/lib/lp/auth";
import { db } from "@/lib/db";
import { waFetchTemplatesFull } from "@/lib/lp/whatsapp";
import { detectVariables } from "@/lib/lp/render";
import { logAudit } from "@/lib/lp/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/lp/templates/sync-meta — pull the REAL approved templates from the
// WhatsApp Business Account and mirror them locally (upsert by name+language).
// Local templates that do NOT exist on Meta are honestly demoted to
// meta_pending — they would fail sends with #132001 and agents must see that.
export async function POST(req: Request) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "templates.manage")) return jsonError("Unauthorized — managers and admins only.", 403);

  const res = await waFetchTemplatesFull();
  if (!res.ok) {
    return Response.json({ error: `Meta template sync failed: ${res.error}` }, { status: 502 });
  }

  const meta = res.data;
  const created: string[] = [];
  const updated: string[] = [];
  const demoted: string[] = [];

  for (const t of meta) {
    const categoryLocal =
      t.category === "MARKETING" ? "marketing" : t.category === "AUTHENTICATION" ? "authentication" : "utility";
    const statusLocal =
      t.status === "APPROVED" ? "meta_approved" : t.status === "REJECTED" ? "meta_rejected" : "meta_pending";

    const existing = await db.template.findFirst({ where: { name: t.name, language: t.language } });
    if (existing) {
      await db.template.update({
        where: { id: existing.id },
        data: {
          bodyText: t.bodyText || existing.bodyText,
          category: categoryLocal,
          approvalStatus: statusLocal,
          metaTemplateId: t.metaTemplateId,
          variables: JSON.stringify(t.variables.length ? t.variables : detectVariables(t.bodyText || "")),
          archived: false,
        },
      });
      (statusLocal === "meta_approved" ? updated : updated).push(t.name);
    } else if (t.bodyText) {
      await db.template.create({
        data: {
          name: t.name,
          category: categoryLocal,
          language: t.language,
          kind: "whatsapp_template",
          bodyText: t.bodyText,
          variables: JSON.stringify(t.variables.length ? t.variables : detectVariables(t.bodyText)),
          approvalStatus: statusLocal,
          metaTemplateId: t.metaTemplateId,
        },
      });
      created.push(t.name);
    }
  }

  // Demote local-only "approved" templates that Meta does not know about
  const locals = await db.template.findMany({ where: { kind: "whatsapp_template", approvalStatus: "meta_approved", archived: false } });
  const metaKeys = new Set(meta.map((t) => `${t.name.toLowerCase()}|${t.language.toLowerCase()}`));
  for (const l of locals) {
    if (!metaKeys.has(`${l.name.toLowerCase()}|${l.language.toLowerCase()}`)) {
      await db.template.update({ where: { id: l.id }, data: { approvalStatus: "meta_pending" } });
      demoted.push(l.name);
    }
  }

  await logAudit({
    actorId: user.id, actorName: user.name, action: "template.sync_meta",
    entity: "template", detail: `meta=${meta.length} created=${created.length} updated=${updated.length} demoted=${demoted.length}`,
  });

  return Response.json({
    ok: true,
    metaCount: meta.length,
    created, updated, demoted,
    templates: meta.map((t) => ({
      name: t.name, category: t.category, language: t.language, status: t.status,
      bodyText: t.bodyText, variables: t.variables, updatedAt: t.updatedAt,
    })),
  });
}
