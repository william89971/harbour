import { NextResponse } from "next/server";
import { withAuth, withOperator } from "@/lib/auth";
import {
  listGoalsAsync,
  createGoalAsync,
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

export const GET = withAuth(async (req) => {
  const statusParam = req.nextUrl.searchParams.get("status");
  const status = isGoalStatus(statusParam) ? statusParam : undefined;
  return NextResponse.json(await listGoalsAsync(status));
});

export const POST = withOperator(async (req) => {
  const body = await req.json();
  if (!body.title || typeof body.title !== "string") {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (body.status !== undefined && !isGoalStatus(body.status)) {
    return NextResponse.json({ error: `status must be one of ${GOAL_STATUSES.join(", ")}` }, { status: 400 });
  }
  if (body.priority !== undefined && !isGoalPriority(body.priority)) {
    return NextResponse.json({ error: `priority must be one of ${GOAL_PRIORITIES.join(", ")}` }, { status: 400 });
  }
  const goal = await createGoalAsync({
    title: body.title,
    notes: body.notes ?? null,
    status: body.status,
    priority: body.priority,
    targetDate: body.target_date ?? null,
  });
  return NextResponse.json(goal, { status: 201 });
});
