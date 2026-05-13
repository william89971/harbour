import { NextResponse } from "next/server";
import { withUserAuth, withUserOperator, withOperator } from "@/lib/auth";
import { listConversationsAsync, createConversationAsync } from "@/lib/db/captain";
import { getSettingAsync } from "@/lib/db/settings";

export const GET = withUserAuth(async (_req, auth) => {
  const conversations = await listConversationsAsync(auth.userId);
  return NextResponse.json(conversations);
});

export const POST = withUserOperator(async (req, auth) => {
  const body = await req.json();
  const title = body.title || "New conversation";

  const [cliSetting, model, thinking, cwd] = await Promise.all([
    getSettingAsync("captain_cli"),
    getSettingAsync("captain_model"),
    getSettingAsync("captain_thinking"),
    getSettingAsync("captain_cwd"),
  ]);
  const cli = cliSetting || "claude";

  const conversation = await createConversationAsync(title, cli, model || null, thinking || null, cwd || null, auth.userId);
  return NextResponse.json(conversation, { status: 201 });
});
