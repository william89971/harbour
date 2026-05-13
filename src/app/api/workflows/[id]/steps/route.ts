import { NextResponse } from "next/server";
import { withOperator } from "@/lib/auth";
import { getWorkflowByIdAsync, createWorkflowStepAsync } from "@/lib/db/queries";
import { detectRiskyInstructions } from "@/lib/workflow-risky";

export const POST = withOperator(async (req, _auth, { params }) => {
  const { id } = await params;
  const workflow = await getWorkflowByIdAsync(id);
  if (!workflow) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  const body = await req.json();
  if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (typeof body.instructions !== "string") {
    return NextResponse.json({ error: "instructions is required (string)" }, { status: 400 });
  }
  // If risky wasn't explicitly set, infer from the instructions.
  const risky = body.risky !== undefined ? !!body.risky : detectRiskyInstructions(body.instructions);
  try {
    const step = await createWorkflowStepAsync(id, {
      name: body.name.trim(),
      description: body.description ?? null,
      instructions: body.instructions,
      assignedAgentId: body.assignedAgentId ?? null,
      assignedTeamId: body.assignedTeamId ?? null,
      preferredRole: body.preferredRole ?? null,
      roleFallback: body.roleFallback ?? "any",
      requiresHumanApproval: !!body.requiresHumanApproval,
      approvalType: body.approvalType ?? "none",
      risky,
      timeoutMinutes: body.timeoutMinutes ?? 30,
    });
    return NextResponse.json(step, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
});
