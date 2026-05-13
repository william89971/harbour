import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { getUserByIdAsync, getAgentByIdAsync } from "@/lib/db/queries";

export const GET = withAuth(async (req, auth) => {
  if (auth.type === "user") {
    const user = await getUserByIdAsync(auth.userId);
    return NextResponse.json({ type: "user", user });
  }

  const agent = await getAgentByIdAsync(auth.agentId);
  return NextResponse.json({ type: "agent", agent });
});
