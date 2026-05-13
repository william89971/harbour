import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import {
  getWorkflowRunByIdAsync, getWorkflowByIdAsync,
  listWorkflowStepRunsAsync, listWorkflowStepsAsync,
  listWorkflowRunActivityAsync,
} from "@/lib/db/queries";

export const GET = withAuth(async (_req, _auth, { params }) => {
  const { id } = await params;
  const run = await getWorkflowRunByIdAsync(id);
  if (!run) return NextResponse.json({ error: "Workflow run not found" }, { status: 404 });
  const [workflow, stepRuns, steps, activity] = await Promise.all([
    getWorkflowByIdAsync(run.workflow_id),
    listWorkflowStepRunsAsync(id),
    listWorkflowStepsAsync(run.workflow_id),
    listWorkflowRunActivityAsync(id),
  ]);
  return NextResponse.json({ ...run, workflow, step_runs: stepRuns, steps, activity });
});
