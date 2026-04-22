import { NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth";
import { getConversation, updateConversation, deleteConversation, listMessages } from "@/lib/db/captain";
import { stop as stopProcess } from "@/lib/captain/process-manager";

export const GET = withUserAuth(async (_req, auth, { params }) => {
  const { id } = await params;
  const conversation = getConversation(id);
  if (!conversation || conversation.user_id !== auth.userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const messages = listMessages(id);
  return NextResponse.json({ ...conversation, messages });
});

export const PUT = withUserAuth(async (req, auth, { params }) => {
  const { id } = await params;
  const conversation = getConversation(id);
  if (!conversation || conversation.user_id !== auth.userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await req.json();
  if (body.title) {
    updateConversation(id, { title: body.title });
  }
  return NextResponse.json(getConversation(id));
});

export const DELETE = withUserAuth(async (_req, auth, { params }) => {
  const { id } = await params;
  const conversation = getConversation(id);
  if (!conversation || conversation.user_id !== auth.userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  stopProcess(id);
  deleteConversation(id);
  return NextResponse.json({ ok: true });
});
