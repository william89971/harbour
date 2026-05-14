import { NextResponse } from "next/server";
import { withUserOperator } from "@/lib/auth";
import {
  getWorkflowRunByIdAsync,
  approveCurrentStepAsync,
  createTaskAsync,
  createDecisionAsync,
  TASK_STATUSES,
  TASK_PRIORITIES,
  type TaskStatus,
  type TaskPriority,
  type TaskRow,
  type DecisionRow,
} from "@/lib/db/queries";
import { WorkflowConflictError } from "@/lib/db/workflows";

type TaskInput = {
  title?: unknown;
  notes?: unknown;
  status?: unknown;
  priority?: unknown;
  goal_id?: unknown;
};

type DecisionInput = {
  title?: unknown;
  decision?: unknown;
  rationale?: unknown;
  consequences?: unknown;
};

function isTaskStatus(v: unknown): v is TaskStatus {
  return typeof v === "string" && (TASK_STATUSES as string[]).includes(v);
}
function isTaskPriority(v: unknown): v is TaskPriority {
  return typeof v === "string" && (TASK_PRIORITIES as string[]).includes(v);
}

/** POST /api/workflow-runs/:id/save-proposal
 *
 * Persists the proposed tasks and decisions emitted by a workflow run's
 * draft step (e.g. the Product Review Loop). Optionally finishes the
 * workflow by approving the current step.
 */
export const POST = withUserOperator(async (req, auth, { params }) => {
  const { id } = await params;
  const wfRun = await getWorkflowRunByIdAsync(id);
  if (!wfRun) {
    return NextResponse.json({ error: "Workflow run not found" }, { status: 404 });
  }

  let body: { tasks?: TaskInput[]; decisions?: DecisionInput[]; approveWorkflowRun?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const tasksIn = Array.isArray(body.tasks) ? body.tasks : [];
  const decisionsIn = Array.isArray(body.decisions) ? body.decisions : [];

  for (const t of tasksIn) {
    if (typeof t.title !== "string" || !t.title.trim()) {
      return NextResponse.json({ error: "every task must have a non-empty title" }, { status: 400 });
    }
    if (t.status !== undefined && !isTaskStatus(t.status)) {
      return NextResponse.json({ error: `task status must be one of ${TASK_STATUSES.join(", ")}` }, { status: 400 });
    }
    if (t.priority !== undefined && !isTaskPriority(t.priority)) {
      return NextResponse.json({ error: `task priority must be one of ${TASK_PRIORITIES.join(", ")}` }, { status: 400 });
    }
  }
  for (const d of decisionsIn) {
    if (typeof d.title !== "string" || !d.title.trim()) {
      return NextResponse.json({ error: "every decision must have a non-empty title" }, { status: 400 });
    }
    if (typeof d.decision !== "string" || !d.decision.trim()) {
      return NextResponse.json({ error: "every decision must have a non-empty decision body" }, { status: 400 });
    }
  }

  const createdTasks: TaskRow[] = [];
  const createdDecisions: DecisionRow[] = [];

  for (const t of tasksIn) {
    const row = await createTaskAsync({
      title: (t.title as string).trim(),
      notes: typeof t.notes === "string" ? t.notes : null,
      status: isTaskStatus(t.status) ? t.status : undefined,
      priority: isTaskPriority(t.priority) ? t.priority : undefined,
      goalId: typeof t.goal_id === "string" && t.goal_id ? t.goal_id : null,
    });
    createdTasks.push(row);
  }
  for (const d of decisionsIn) {
    const row = await createDecisionAsync({
      title: (d.title as string).trim(),
      decision: (d.decision as string).trim(),
      rationale: typeof d.rationale === "string" && d.rationale ? d.rationale : null,
      consequences: typeof d.consequences === "string" && d.consequences ? d.consequences : null,
    });
    createdDecisions.push(row);
  }

  let approvalApplied = false;
  if (body.approveWorkflowRun !== false && wfRun.status === "waiting_for_approval") {
    try {
      await approveCurrentStepAsync(id, {
        userId: auth.userId,
        userName: auth.displayName,
        comment: createdTasks.length + createdDecisions.length > 0
          ? `Saved ${createdTasks.length} task(s) and ${createdDecisions.length} decision(s) from proposal.`
          : "Approved without saving any proposal items.",
      });
      approvalApplied = true;
    } catch (err) {
      if (err instanceof WorkflowConflictError) {
        return NextResponse.json(
          { created: { tasks: createdTasks, decisions: createdDecisions }, approvalApplied: false, conflict: err.message },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { created: { tasks: createdTasks, decisions: createdDecisions }, approvalApplied: false, error: (err as Error).message },
        { status: 400 },
      );
    }
  }

  return NextResponse.json({
    created: { tasks: createdTasks, decisions: createdDecisions },
    approvalApplied,
  });
});
