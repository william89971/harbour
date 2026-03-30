import { NextRequest, NextResponse } from "next/server";
import { getAuthFromRequest, requireAuth } from "@/lib/auth";
import { getAgentById, touchAgentPolled, getAgentNextRun, peekAgentNext } from "@/lib/db/queries";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthFromRequest(req);
  const authError = requireAuth(auth);
  if (authError) return authError;

  const { id } = await params;
  const existing = getAgentById(id);
  if (!existing) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  touchAgentPolled(id);

  const peek = req.nextUrl.searchParams.get("peek") === "true";
  if (peek) {
    const result = peekAgentNext(id);
    return NextResponse.json(result);
  }

  const payload = getAgentNextRun(id);
  if (!payload) {
    return NextResponse.json(null);
  }

  return NextResponse.json(payload);
}
