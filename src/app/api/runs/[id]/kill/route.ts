import { NextResponse } from "next/server";
import { withAuth, withUserAuth, requireAgentOwnership } from "@/lib/auth";
import { getRunByIdAsync, requestKillRunAsync, addRunActivityAsync, isKillRequestedAsync } from "@/lib/db/queries";

/**
 * Lightweight kill-check endpoint for the runner's fallback poll. Returns
 * just the kill flag — no activity, no attachments — so the runner can poll
 * cheaply every 10s without pulling the whole run down.
 */
export const GET = withAuth(async (_req, auth, { params }) => {
  const { id } = await params;
  const run = await getRunByIdAsync(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const ownerError = requireAgentOwnership(auth, run.agent_id as string | null);
  if (ownerError) return ownerError;

  return NextResponse.json({ kill_requested: await isKillRequestedAsync(id), status: run.status });
});

export const POST = withUserAuth(async (_req, auth, { params }) => {
  const { id } = await params;
  const run = await getRunByIdAsync(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  if (run.agent_type !== "harbour") {
    return NextResponse.json(
      { error: "Only harbour-agent runs can be killed. External agents run outside Harbour's control." },
      { status: 400 },
    );
  }

  if (run.status !== "running") {
    return NextResponse.json(
      { error: `Cannot kill a run in status '${run.status}' — only 'running' runs can be killed.` },
      { status: 409 },
    );
  }

  const ok = await requestKillRunAsync(id);
  if (!ok) {
    return NextResponse.json({ error: "Failed to request kill" }, { status: 500 });
  }

  await addRunActivityAsync(id, "system", null, "System", `Kill requested by **${auth.displayName}**`);

  return NextResponse.json({ ok: true, kill_requested: true });
});
