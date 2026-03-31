import { NextRequest, NextResponse } from "next/server";
import { requireAuth, getAuthFromRequest } from "@/lib/auth";
import { getRunById, updateRunStatus, addRunActivity } from "@/lib/db/queries";

const RETRYABLE = ["failed", "skipped"];

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthFromRequest(req);
  const authError = requireAuth(auth);
  if (authError) return authError;
  if (auth!.type !== "user") {
    return NextResponse.json({ error: "Only users can retry runs" }, { status: 403 });
  }

  const { id } = await params;
  const run = getRunById(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  if (!RETRYABLE.includes(run.status)) {
    return NextResponse.json({ error: `Can only retry runs with status: ${RETRYABLE.join(", ")}` }, { status: 400 });
  }

  const updated = updateRunStatus(id, "pending");
  addRunActivity(id, "system", null, "System", `Run retried by **${auth!.displayName}**`);

  return NextResponse.json(updated);
}
