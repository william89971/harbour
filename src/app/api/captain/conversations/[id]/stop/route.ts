import { NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth";
import { getConversation } from "@/lib/db/captain";
import { stop, isRunning } from "@/lib/captain/process-manager";

export const POST = withUserAuth(async (_req, auth, { params }) => {
  const { id } = await params;
  const conversation = getConversation(id);
  if (!conversation || conversation.user_id !== auth.userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!isRunning(id)) {
    return NextResponse.json({ error: "No active response" }, { status: 400 });
  }

  stop(id);
  return NextResponse.json({ ok: true });
});
