import { NextRequest, NextResponse } from "next/server";
import { withAuth, withOperator } from "@/lib/auth";
import { requireTool } from "@/lib/tool-permissions";
import { listRunningRunsAsync, listWaitingRunsAsync, listRecentRunsAsync, listScheduledRunsAsync, createOneOffRunAsync } from "@/lib/db/queries";
import { getRecentRunsLimitAsync } from "@/lib/db/settings";

export const GET = withAuth(async (req) => {
  const filter = req.nextUrl.searchParams.get("filter");
  const projectId = req.nextUrl.searchParams.get("projectId") || undefined;
  if (filter === "waiting") {
    return NextResponse.json(await listWaitingRunsAsync(projectId));
  }
  const limit = await getRecentRunsLimitAsync();
  if (filter === "recent") {
    return NextResponse.json(await listRecentRunsAsync(limit, projectId));
  }

  // Default: return all sections
  const [scheduled, running, waiting, recent] = await Promise.all([
    listScheduledRunsAsync(projectId),
    listRunningRunsAsync(projectId),
    listWaitingRunsAsync(projectId),
    listRecentRunsAsync(limit, projectId),
  ]);
  return NextResponse.json({ scheduled, running, waiting, recent });
});

export const POST = withOperator(async (req, auth) => {
  const toolErr = requireTool(auth, "create_runs");
  if (toolErr) return toolErr;
  const body = await req.json();
  if (!body.agentId || !body.name) {
    return NextResponse.json({ error: "agentId and name are required" }, { status: 400 });
  }

  const result = await createOneOffRunAsync(body.agentId, {
    name: body.name,
    instructions: body.instructions,
    docIds: body.docIds,
    envVarIds: body.envVarIds,
    runAt: body.runAt,
  });

  return NextResponse.json(result, { status: 201 });
});
