import { NextRequest, NextResponse } from "next/server";
import { getAuthFromRequest, requireAuth } from "@/lib/auth";
import { getUserById, getAgentById } from "@/lib/db/queries";

export async function GET(req: NextRequest) {
  const auth = await getAuthFromRequest(req);
  const authError = requireAuth(auth);
  if (authError) return authError;

  if (auth!.type === "user") {
    const user = getUserById(auth!.userId);
    return NextResponse.json({ type: "user", user });
  }

  const agent = getAgentById(auth!.agentId);
  return NextResponse.json({ type: "agent", agent });
}
