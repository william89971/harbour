import { NextResponse } from "next/server";
import { withUserOperator } from "@/lib/auth";
import { addWorkflowCommentAsync } from "@/lib/db/queries";

// User-only: workflow-run comments are part of the human-approval thread.
// Agents posting here would let a misbehaving agent forge operator commentary
// on its own approval request.
export const POST = withUserOperator(async (req, auth, { params }) => {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (!body.content || typeof body.content !== "string" || !body.content.trim()) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }
  const content = body.content.trim();
  if (content.length > 5000) {
    return NextResponse.json({ error: "content too long (max 5000 chars)" }, { status: 400 });
  }
  try {
    await addWorkflowCommentAsync(id, { userId: auth.userId, userName: auth.displayName, content });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
});
