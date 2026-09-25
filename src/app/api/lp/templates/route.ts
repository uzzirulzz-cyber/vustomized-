import { db } from "@/lib/db";
import { getAuthUser, can, jsonError } from "@/lib/lp/auth";
import { detectVariables } from "@/lib/lp/render";
import { logAudit } from "@/lib/lp/activity";

export async function GET(req: Request) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "templates.read")) return jsonError("Unauthorized", 401);
  const templates = await db.template.findMany({
    where: { archived: false },
    orderBy: { createdAt: "desc" },
  });
  return Response.json({ templates });
}

export async function POST(req: Request) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "templates.manage")) return jsonError("Unauthorized", 401);
  const body = await req.json().catch(() => ({}));
  if (!body.name || !body.bodyText) return jsonError("name and bodyText are required.", 400);

  const kind = body.kind === "free_form" ? "free_form" : "whatsapp_template";
  const template = await db.template.create({
    data: {
      name: String(body.name).slice(0, 120),
      category: body.category || "utility",
      language: body.language || "en",
      kind,
      bodyText: String(body.bodyText),
      variables: JSON.stringify(detectVariables(String(body.bodyText))),
      // free-form messages need NO Meta approval; WhatsApp templates DO (§7)
      approvalStatus: kind === "free_form" ? "free_form" : "meta_pending",
    },
  });
  await logAudit({ actorId: user.id, actorName: user.name, action: "template.create", entity: "template", entityId: template.id, detail: template.name });
  return Response.json({ template }, { status: 201 });
}
