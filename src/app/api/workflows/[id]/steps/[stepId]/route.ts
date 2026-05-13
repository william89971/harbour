import { NextResponse } from "next/server";
import { withOperator } from "@/lib/auth";
import { updateWorkflowStepAsync, deleteWorkflowStepAsync } from "@/lib/db/queries";

export const PUT = withOperator(async (req, _auth, { params }) => {
  const { stepId } = await params;
  const body = await req.json();
  try {
    const step = await updateWorkflowStepAsync(stepId, body);
    if (!step) return NextResponse.json({ error: "Step not found" }, { status: 404 });
    return NextResponse.json(step);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
});

export const DELETE = withOperator(async (_req, _auth, { params }) => {
  const { stepId } = await params;
  await deleteWorkflowStepAsync(stepId);
  return NextResponse.json({ ok: true });
});
