import { getAuthUser, can, jsonError } from "@/lib/lp/auth";
import { previewImport } from "@/lib/lp/csv";

// POST raw CSV text → full validation preview (spec §2)
export async function POST(req: Request) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "import.run")) return jsonError("Unauthorized", 401);
  const { csv } = await req.json().catch(() => ({}));
  if (!csv || typeof csv !== "string" || csv.trim().length < 5) {
    return jsonError("Provide the raw CSV content in `csv`.", 400);
  }
  const preview = await previewImport(csv);
  return Response.json({ preview });
}
