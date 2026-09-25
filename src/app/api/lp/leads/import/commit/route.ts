import { db } from "@/lib/db";
import { getAuthUser, can, jsonError } from "@/lib/lp/auth";
import { commitImport } from "@/lib/lp/csv";
import { logAudit } from "@/lib/lp/activity";

export async function POST(req: Request) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "import.run")) return jsonError("Unauthorized", 401);
  const { csv, importValidOnly } = await req.json().catch(() => ({}));
  if (!csv || typeof csv !== "string" || csv.trim().length < 5) {
    return jsonError("Provide the raw CSV content in `csv`.", 400);
  }

  // employee name → id map for the optional Assigned Employee column
  const users = await db.user.findMany({ select: { id: true, name: true } });
  const employeeIdMap: Record<string, string> = {};
  for (const u of users) employeeIdMap[u.name.toLowerCase()] = u.id;

  const result = await commitImport(csv, {
    importValidOnly: importValidOnly !== false,
    importedById: user.id,
    employeeIdMap,
  });
  await logAudit({
    actorId: user.id, actorName: user.name,
    action: "leads.import", entity: "import_batch", entityId: result.batchId,
    detail: `imported=${result.imported} skipped=${result.skipped}`,
  });
  return Response.json(result, { status: 201 });
}
