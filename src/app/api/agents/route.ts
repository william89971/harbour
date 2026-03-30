import { NextRequest, NextResponse } from "next/server";
import { getAuthFromRequest, requireAuth } from "@/lib/auth";
import { listAgents, createAgent } from "@/lib/db/queries";

export async function GET(req: NextRequest) {
  const auth = await getAuthFromRequest(req);
  const authError = requireAuth(auth);
  if (authError) return authError;

  return NextResponse.json(listAgents());
}

export async function POST(req: NextRequest) {
  const auth = await getAuthFromRequest(req);
  const authError = requireAuth(auth);
  if (authError) return authError;
  if (auth!.type !== "user") {
    return NextResponse.json({ error: "Only users can create agents" }, { status: 403 });
  }

  const body = await req.json();
  const { name, description } = body;
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const agent = createAgent(name, description);
  return NextResponse.json(agent, { status: 201 });
}
