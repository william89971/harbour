import { NextResponse } from "next/server";
import { withAuth, withOperator, requireAgentOwnership } from "@/lib/auth";
import { requireTool } from "@/lib/tool-permissions";
import { getRunByIdAsync, createHandoffAsync } from "@/lib/db/queries";

export const POST = withOperator(async (req, auth, { params }) => {
  const { id } = await params;
  const run = await getRunByIdAsync(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  // An agent caller can only hand off from a run on its own agent.
  const ownerError = requireAgentOwnership(auth, run.agent_id);
  if (ownerError) return ownerError;
  const toolError = requireTool(auth, "create_handoffs");
  if (toolError) return toolError;

  const body = await req.json();
  const { targetAgentId, targetTeamId, targetRole, message } = body;

  if (!message || typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }
  const hasAgent = !!targetAgentId;
  const hasTeam = !!targetTeamId;
  if (hasAgent === hasTeam) {
    return NextResponse.json({ error: "exactly one of targetAgentId or targetTeamId is required" }, { status: 400 });
  }

  try {
    const handoff = await createHandoffAsync(id, {
      targetAgentId: targetAgentId || null,
      targetTeamId: targetTeamId || null,
      targetRole: targetRole || null,
      message: message.trim(),
    });
    return NextResponse.json(handoff, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
});
