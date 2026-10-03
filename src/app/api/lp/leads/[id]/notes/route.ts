import { db } from "@/lib/db";
import { getAuthUser, can, jsonError } from "@/lib/lp/auth";
import { logActivity } from "@/lib/lp/activity";

// POST — add a CRM note to a lead (permanent record, spec §3/§12)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  if (!user || !can(user.role, "leads.write")) return jsonError("Unauthorized", 401);
  const { id } = await params;
  const { body } = await req.json().catch(() => ({}));
  if (!body || !String(body).trim()) return jsonError("Note body required", 400);

  const lead = await db.lead.findUnique({ where: { id } });
  if (!lead) return jsonError("Lead not found", 404);

  const note = await db.leadNote.create({
    data: { leadId: id, authorId: user.id, body: String(body).trim().slice(0, 5000) },
    include: { author: { select: { name: true } } },
  });
  await logActivity({ leadId: id, actorId: user.id, type: "note_added", title: "Note added." });
  return Response.json({ note }, { status: 201 });
}
