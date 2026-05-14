import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { computeAgentScorecardAsync } from "@/lib/db/scorecards";

export const GET = withAuth(async (_req, _auth, { params }) => {
  const { id } = await params;
  const card = await computeAgentScorecardAsync(id);
  if (!card) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  return NextResponse.json(card);
});
