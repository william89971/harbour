import { NextResponse } from "next/server";
// User-only: rotating an agent's API key is a management action. With bare
// withOperator, an agent Bearer token can rotate ANY agent's key — its own
// (locking out its runner) or a peer's (DoS).
import { withUserOperator } from "@/lib/auth";
import { getAgentByIdAsync, rotateAgentKeyAsync } from "@/lib/db/queries";

export const POST = withUserOperator(async (_req, _auth, { params }) => {
  const { id } = await params;
  const existing = await getAgentByIdAsync(id);
  if (!existing) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const apiKey = await rotateAgentKeyAsync(id);
  return NextResponse.json({ apiKey });
});
