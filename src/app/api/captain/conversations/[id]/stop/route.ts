import { NextResponse } from "next/server";
import { withUserAuth, withUserOperator, withOperator } from "@/lib/auth";
import { getConversationAsync } from "@/lib/db/captain";
import { stop, isRunning } from "@/lib/captain/process-manager";

export const POST = withUserOperator(async (_req, auth, { params }) => {
  const { id } = await params;
  const conversation = await getConversationAsync(id);
  if (!conversation || conversation.user_id !== auth.userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!isRunning(id)) {
    return NextResponse.json({ error: "No active response" }, { status: 400 });
  }

  stop(id);
  return NextResponse.json({ ok: true });
});
