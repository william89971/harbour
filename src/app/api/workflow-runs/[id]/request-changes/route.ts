import { NextResponse } from "next/server";
import { withUserOperator } from "@/lib/auth";
import { requestStepChangesAsync } from "@/lib/db/queries";
import { WorkflowConflictError } from "@/lib/db/workflows";

const MAX_COMMENT_LEN = 5000;
const MAX_INSTRUCTIONS_LEN = 5000;

// User-only: requesting changes is part of the human-approval loop.
export const POST = withUserOperator(async (req, auth, { params }) => {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (!body.comment || typeof body.comment !== "string" || !body.comment.trim()) {
    return NextResponse.json({ error: "comment is required" }, { status: 400 });
  }
  const comment = body.comment.trim();
  if (comment.length > MAX_COMMENT_LEN) {
    return NextResponse.json({ error: `comment too long (max ${MAX_COMMENT_LEN} chars)` }, { status: 400 });
  }
  const extraInstructions = typeof body.extraInstructions === "string" ? body.extraInstructions : null;
  if (extraInstructions && extraInstructions.length > MAX_INSTRUCTIONS_LEN) {
    return NextResponse.json({ error: `extraInstructions too long (max ${MAX_INSTRUCTIONS_LEN} chars)` }, { status: 400 });
  }
  try {
    await requestStepChangesAsync(id, { userId: auth.userId, userName: auth.displayName, comment, extraInstructions });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof WorkflowConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
});
