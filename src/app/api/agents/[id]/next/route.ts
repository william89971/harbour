import { NextRequest, NextResponse } from "next/server";
import { getAuthFromRequest, requireAuth } from "@/lib/auth";
import { getAgentById, touchAgentPolled, getAgentNextRun, peekAgentNext } from "@/lib/db/queries";

function buildApiSection(req: NextRequest, runId: string) {
  const base = `${req.nextUrl.protocol}//${req.nextUrl.host}`;
  return {
    base_url: base,
    endpoints: {
      update_status: `PUT ${base}/api/runs/${runId}/status`,
      post_activity: `POST ${base}/api/runs/${runId}/activity`,
      create_doc: `POST ${base}/api/docs`,
      update_doc: `PUT ${base}/api/docs/:id`,
      create_database: `POST ${base}/api/databases`,
      insert_rows: `POST ${base}/api/databases/:id/rows`,
      read_rows: `GET ${base}/api/databases/:id/rows`,
      guide: `GET ${base}/api/guide`,
    },
    status_options: ["done", "failed", "waiting"],
    notes: [
      "You MUST set a final status (done/failed) when finished, or waiting if you need human input.",
      "Post activity messages to log progress — these are visible on the dashboard.",
      "Full API spec available at the guide endpoint.",
    ],
  };
}

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

  return NextResponse.json({
    ...payload,
    api: buildApiSection(req, payload.run.id),
  });
}
