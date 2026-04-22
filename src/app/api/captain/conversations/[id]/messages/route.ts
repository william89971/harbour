import { NextResponse } from "next/server";
import crypto from "crypto";
import { withUserAuth } from "@/lib/auth";
import { getConversation, createMessage, deleteCaptainOutput } from "@/lib/db/captain";
import { isRunning, spawn } from "@/lib/captain/process-manager";

export const POST = withUserAuth(async (req, auth, { params }) => {
  const { id } = await params;
  const conversation = getConversation(id);
  if (!conversation || conversation.user_id !== auth.userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (isRunning(id)) {
    return NextResponse.json(
      { error: "A response is already in progress" },
      { status: 409 }
    );
  }

  const body = await req.json();
  const prompt = body.message?.trim();
  if (!prompt) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  // Store user message
  const userMessage = createMessage(id, "user", prompt);

  // Create placeholder assistant message
  const assistantMessage = createMessage(id, "assistant", "");

  // Clear old output events for this conversation (keep only current response)
  deleteCaptainOutput(id);

  // Determine session state
  const isNewSession = !conversation.session_id;
  const sessionId = conversation.session_id || crypto.randomUUID();

  // Fire and forget — spawn the CLI process
  spawn({
    conversationId: id,
    messageId: assistantMessage.id,
    prompt,
    cli: conversation.cli,
    model: conversation.model,
    thinking: conversation.thinking,
    sessionId,
    isNewSession,
    cwd: conversation.cwd,
  }).catch(() => {
    // Error handling is done inside spawn's finally block
  });

  return NextResponse.json(
    { messageId: assistantMessage.id, userMessageId: userMessage.id },
    { status: 202 }
  );
});
