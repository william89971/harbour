import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { sumCostsTotalAsync, breakdownByModelAsync, topAgentsByCostAsync, topJobsByCostAsync } from "@/lib/db/costs";

export const GET = withAuth(async (req) => {
  const projectId = req.nextUrl.searchParams.get("projectId") || undefined;
  const [summary, breakdown, topAgents, topJobs] = await Promise.all([
    sumCostsTotalAsync(projectId),
    breakdownByModelAsync(projectId),
    topAgentsByCostAsync(10, projectId),
    topJobsByCostAsync(10, projectId),
  ]);
  return NextResponse.json({ ...summary, breakdown, topAgents, topJobs });
});
