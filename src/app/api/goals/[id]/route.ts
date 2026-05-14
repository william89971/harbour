import { NextResponse } from "next/server";
import { withAuth, withOperator } from "@/lib/auth";
import {
  getGoalByIdAsync,
  updateGoalAsync,
  deleteGoalAsync,
  GOAL_STATUSES,
  GOAL_PRIORITIES,
  type GoalStatus,
  type GoalPriority,
} from "@/lib/db/goals";

function isGoalStatus(v: unknown): v is GoalStatus {
  return typeof v === "string" && (GOAL_STATUSES as string[]).includes(v);
}
function isGoalPriority(v: unknown): v is GoalPriority {
  return typeof v === "string" && (GOAL_PRIORITIES as string[]).includes(v);
}

export const GET = withAuth(async (_req, _auth, { params }) => {
  const { id } = await params;
  const goal = await getGoalByIdAsync(id);
  if (!goal) return NextResponse.json({ error: "Goal not found" }, { status: 404 });
  return NextResponse.json(goal);
});

export const PUT = withOperator(async (req, _auth, { params }) => {
  const { id } = await params;
  const existing = await getGoalByIdAsync(id);
  if (!existing) return NextResponse.json({ error: "Goal not found" }, { status: 404 });
  const body = await req.json();
  if (body.status !== undefined && !isGoalStatus(body.status)) {
    return NextResponse.json({ error: `status must be one of ${GOAL_STATUSES.join(", ")}` }, { status: 400 });
  }
  if (body.priority !== undefined && !isGoalPriority(body.priority)) {
    return NextResponse.json({ error: `priority must be one of ${GOAL_PRIORITIES.join(", ")}` }, { status: 400 });
  }
  const updated = await updateGoalAsync(id, {
    title: body.title,
    notes: body.notes,
    status: body.status,
    priority: body.priority,
    targetDate: body.target_date,
  });
  return NextResponse.json(updated);
});

export const DELETE = withOperator(async (_req, _auth, { params }) => {
  const { id } = await params;
  await deleteGoalAsync(id);
  return NextResponse.json({ ok: true });
});
