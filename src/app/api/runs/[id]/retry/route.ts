import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth";
import { getRunByIdAsync, updateRunStatusAsync, addRunActivityAsync } from "@/lib/db/queries";

const RETRYABLE = ["failed", "skipped", "killed"];

export const POST = withUserAuth(async (req, auth, { params }) => {
  const { id } = await params;
  const run = await getRunByIdAsync(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  if (!RETRYABLE.includes(run.status)) {
    return NextResponse.json({ error: `Can only retry runs with status: ${RETRYABLE.join(", ")}` }, { status: 400 });
  }

  const updated = await updateRunStatusAsync(id, "pending");
  await addRunActivityAsync(id, "system", null, "System", `Run retried by **${auth.displayName}**`);

  return NextResponse.json(updated);
});
