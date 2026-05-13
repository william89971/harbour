import { NextResponse } from "next/server";
import { withUserOperator } from "@/lib/auth";
import { rejectWorkflowRunAsync } from "@/lib/db/queries";
import { WorkflowConflictError } from "@/lib/db/workflows";

const MAX_COMMENT_LEN = 5000;

// User-only: agents must not reject workflow runs (see approve/route.ts).
export const POST = withUserOperator(async (req, auth, { params }) => {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const comment = typeof body.comment === "string" ? body.comment : null;
  if (comment && comment.length > MAX_COMMENT_LEN) {
    return NextResponse.json({ error: `comment too long (max ${MAX_COMMENT_LEN} chars)` }, { status: 400 });
  }
  try {
    await rejectWorkflowRunAsync(id, { userId: auth.userId, userName: auth.displayName, comment });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof WorkflowConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
});
