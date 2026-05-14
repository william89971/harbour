import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { listAgentScorecardsAsync } from "@/lib/db/scorecards";

export const GET = withAuth(async () => {
  return NextResponse.json(await listAgentScorecardsAsync());
});
