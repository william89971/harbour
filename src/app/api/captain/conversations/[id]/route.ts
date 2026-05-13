import { NextResponse } from "next/server";
import { withUserAuth, withUserOperator, withOperator } from "@/lib/auth";
import { getConversationAsync, updateConversationAsync, deleteConversationAsync, listMessagesAsync, listToolEventsByMessageAsync } from "@/lib/db/captain";
import { stop as stopProcess } from "@/lib/captain/process-manager";

export const GET = withUserAuth(async (_req, auth, { params }) => {
  const { id } = await params;
  const conversation = await getConversationAsync(id);
  if (!conversation || conversation.user_id !== auth.userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const rawMessages = await listMessagesAsync(id);
  const messages = await Promise.all(rawMessages.map(async (msg) => {
    if (msg.role === "assistant") {
      const toolEvents = await listToolEventsByMessageAsync(msg.id);
      return { ...msg, toolEvents };
    }
    return { ...msg, toolEvents: [] };
  }));
  return NextResponse.json({ ...conversation, messages });
});

export const PUT = withUserOperator(async (req, auth, { params }) => {
  const { id } = await params;
  const conversation = await getConversationAsync(id);
  if (!conversation || conversation.user_id !== auth.userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await req.json();
  if (body.title) {
    await updateConversationAsync(id, { title: body.title });
  }
  return NextResponse.json(await getConversationAsync(id));
});

export const DELETE = withUserOperator(async (_req, auth, { params }) => {
  const { id } = await params;
  const conversation = await getConversationAsync(id);
  if (!conversation || conversation.user_id !== auth.userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  stopProcess(id);
  await deleteConversationAsync(id);
  return NextResponse.json({ ok: true });
});
