import { NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth";
import { listConversations, createConversation } from "@/lib/db/captain";
import { getSetting } from "@/lib/db/settings";

export const GET = withUserAuth(async (_req, auth) => {
  const conversations = listConversations(auth.userId);
  return NextResponse.json(conversations);
});

export const POST = withUserAuth(async (req, auth) => {
  const body = await req.json();
  const title = body.title || "New conversation";

  const cli = getSetting("captain_cli") || "claude";
  const model = getSetting("captain_model") || null;
  const thinking = getSetting("captain_thinking") || null;
  const cwd = getSetting("captain_cwd") || null;

  const conversation = createConversation(title, cli, model, thinking, cwd, auth.userId);
  return NextResponse.json(conversation, { status: 201 });
});
