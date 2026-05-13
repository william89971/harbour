import { NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth";
import { getConversationAsync } from "@/lib/db/captain";
import { isRunning, activeMessageId } from "@/lib/captain/process-manager";

export const GET = withUserAuth(async (_req, auth, { params }) => {
  const { id } = await params;
  const conversation = await getConversationAsync(id);
  if (!conversation || conversation.user_id !== auth.userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    running: isRunning(id),
    activeMessageId: activeMessageId(id),
  });
});
