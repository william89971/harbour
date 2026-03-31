import { NextRequest, NextResponse } from "next/server";
import { getAuthFromRequest, requireAuth } from "@/lib/auth";
import { listRunningRuns, listWaitingRuns, listRecentRuns, listScheduledRuns, createOneOffRun } from "@/lib/db/queries";

export async function GET(req: NextRequest) {
  const auth = await getAuthFromRequest(req);
  const authError = requireAuth(auth);
  if (authError) return authError;

  const filter = req.nextUrl.searchParams.get("filter");
  if (filter === "waiting") {
    return NextResponse.json(listWaitingRuns());
  }
  if (filter === "recent") {
    return NextResponse.json(listRecentRuns());
  }

  // Default: return all sections
  return NextResponse.json({
    scheduled: listScheduledRuns(),
    running: listRunningRuns(),
    waiting: listWaitingRuns(),
    recent: listRecentRuns(),
  });
}

export async function POST(req: NextRequest) {
  const auth = await getAuthFromRequest(req);
  const authError = requireAuth(auth);
  if (authError) return authError;

  const body = await req.json();
  if (!body.agentId || !body.name) {
    return NextResponse.json({ error: "agentId and name are required" }, { status: 400 });
  }

  const result = createOneOffRun(body.agentId, {
    name: body.name,
    instructions: body.instructions,
    docIds: body.docIds,
    envVarIds: body.envVarIds,
    runAt: body.runAt,
  });

  return NextResponse.json(result, { status: 201 });
}
