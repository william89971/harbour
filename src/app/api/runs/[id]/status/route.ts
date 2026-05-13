import { NextRequest, NextResponse } from "next/server";
import { withAuth, withOperator, requireAgentOwnership } from "@/lib/auth";
import { requireTool } from "@/lib/tool-permissions";
import { getRunByIdAsync, updateRunStatusAsync, addRunActivityAsync } from "@/lib/db/queries";

const VALID_STATUSES = ["running", "waiting", "pending", "done", "failed", "skipped", "killed"];

export const PUT = withOperator(async (req, auth, { params }) => {
  const { id } = await params;
  const run = await getRunByIdAsync(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const ownerError = requireAgentOwnership(auth, run.agent_id as string | null);
  if (ownerError) return ownerError;
  const toolError = requireTool(auth, "update_status");
  if (toolError) return toolError;

  const body = await req.json();
  if (!body.status || !VALID_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` }, { status: 400 });
  }

  const updated = await updateRunStatusAsync(id, body.status);

  await addRunActivityAsync(id, "system", null, "System", `Status changed to **${body.status}**`);

  return NextResponse.json(updated);
});
