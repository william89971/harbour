import { NextRequest, NextResponse } from "next/server";
import { getAuthFromRequest, requireAuth } from "@/lib/auth";
import { getRunById, updateRunStatus, addRunActivity } from "@/lib/db/queries";

const VALID_STATUSES = ["running", "waiting", "pending", "done", "failed", "skipped"];

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthFromRequest(req);
  const authError = requireAuth(auth);
  if (authError) return authError;

  const { id } = await params;
  const run = getRunById(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const body = await req.json();
  if (!body.status || !VALID_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` }, { status: 400 });
  }

  const updated = updateRunStatus(id, body.status);

  addRunActivity(id, "system", null, "System", `Status changed to **${body.status}**`);

  return NextResponse.json(updated);
}
