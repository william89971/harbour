import { NextRequest, NextResponse } from "next/server";
import { withAuth, withOperator, requireAgentOwnership } from "@/lib/auth";
import { requireTool } from "@/lib/tool-permissions";
import { getRunByIdAsync, addRunOutputAsync, listRunOutputAsync, isKillRequestedAsync } from "@/lib/db/queries";

type OutputEvent = { event_type?: string; content?: string | null; tool_name?: string | null };

export const GET = withAuth(async (req, _auth, { params }) => {
  const { id } = await params;
  const run = await getRunByIdAsync(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const afterId = parseInt(req.nextUrl.searchParams.get("after") || "0", 10);
  return NextResponse.json(await listRunOutputAsync(id, afterId));
});

export const POST = withOperator(async (req, auth, { params }) => {
  const { id } = await params;
  const run = await getRunByIdAsync(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const ownerError = requireAgentOwnership(auth, run.agent_id as string | null);
  if (ownerError) return ownerError;
  // Output events are the streaming companion to /activity — same trust
  // level, same gate. An agent without post_activity shouldn't be able to
  // smuggle text into the run via this side channel.
  const toolError = requireTool(auth, "post_activity");
  if (toolError) return toolError;

  const body = await req.json() as OutputEvent | OutputEvent[];
  const events: OutputEvent[] = Array.isArray(body) ? body : [body];

  if (events.length === 0 || !events.every(e => !!e.event_type)) {
    return NextResponse.json({ error: "event_type is required for each event" }, { status: 400 });
  }

  await addRunOutputAsync(id, events.map(e => ({
    event_type: e.event_type as string,
    content: e.content || null,
    tool_name: e.tool_name || null,
  })));

  // Piggyback the kill signal onto the runner's frequent output POSTs so the
  // runner notices a kill request within one flush cycle (~750ms) instead of
  // waiting for the 10s fallback poll.
  return NextResponse.json({ ok: true, kill_requested: await isKillRequestedAsync(id) }, { status: 201 });
});
