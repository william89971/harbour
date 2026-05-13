import { NextResponse } from "next/server";
import { withOperator } from "@/lib/auth";
import { startWorkflowRunAsync, getWorkflowByIdAsync, listWorkflowStepsAsync } from "@/lib/db/queries";

export const POST = withOperator(async (req, auth, { params }) => {
  const { id } = await params;
  const workflow = await getWorkflowByIdAsync(id);
  if (!workflow) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  if (workflow.status === "archived") {
    return NextResponse.json({ error: "Workflow is archived" }, { status: 400 });
  }
  if (workflow.status === "paused") {
    return NextResponse.json({ error: "Workflow is paused" }, { status: 400 });
  }
  const steps = await listWorkflowStepsAsync(id);
  if (steps.length === 0) {
    return NextResponse.json({ error: "Workflow has no steps" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const inputPayload = body && typeof body.input === "object" && body.input ? body.input as Record<string, unknown> : null;

  const userId = auth.type === "user" ? auth.userId : null;
  const userName = auth.type === "user" ? auth.displayName : auth.agentName;
  try {
    const result = await startWorkflowRunAsync(id, { userId, userName, inputPayload });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
});
