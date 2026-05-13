import { NextResponse } from "next/server";
import { withUserOperator } from "@/lib/auth";
import { resumeAfterChangesAsync } from "@/lib/db/queries";

// User-only: resuming a workflow after changes is a human-approval action.
export const POST = withUserOperator(async (_req, auth, { params }) => {
  const { id } = await params;
  try {
    await resumeAfterChangesAsync(id, { userId: auth.userId, userName: auth.displayName });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
});
