import { NextResponse } from "next/server";
import { withUserOperator } from "@/lib/auth";
import { approveRequestAsync } from "@/lib/db/queries";

export const POST = withUserOperator(async (req, auth, { params }) => {
  const { id } = await params;
  const body = await req.json().catch(() => ({} as { comment?: string }));
  const comment = typeof body.comment === "string" ? body.comment.trim() || null : null;
  const approval = await approveRequestAsync(id, auth.userId, comment);
  if (!approval) {
    return NextResponse.json({ error: "approval is not pending" }, { status: 409 });
  }
  return NextResponse.json({ approval });
});
