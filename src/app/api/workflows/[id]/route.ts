import { NextResponse } from "next/server";
import { withAuth, withOperator } from "@/lib/auth";
import {
  getWorkflowByIdAsync, listWorkflowStepsAsync,
  updateWorkflowAsync, deleteWorkflowAsync,
  listWorkflowRunsAsync,
} from "@/lib/db/queries";

export const GET = withAuth(async (_req, _auth, { params }) => {
  const { id } = await params;
  const workflow = await getWorkflowByIdAsync(id);
  if (!workflow) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  const [steps, runs] = await Promise.all([
    listWorkflowStepsAsync(id),
    listWorkflowRunsAsync(id),
  ]);
  return NextResponse.json({ ...workflow, steps, recent_runs: runs.slice(0, 10) });
});

export const PUT = withOperator(async (req, _auth, { params }) => {
  const { id } = await params;
  const existing = await getWorkflowByIdAsync(id);
  if (!existing) return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  const body = await req.json();
  try {
    const updated = await updateWorkflowAsync(id, {
      name: typeof body.name === "string" ? body.name : undefined,
      description: body.description !== undefined ? body.description : undefined,
      department: body.department !== undefined ? body.department : undefined,
      status: body.status,
      autonomyLevel: body.autonomyLevel,
    });
    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
});

export const DELETE = withOperator(async (_req, _auth, { params }) => {
  const { id } = await params;
  await deleteWorkflowAsync(id);
  return NextResponse.json({ ok: true });
});
