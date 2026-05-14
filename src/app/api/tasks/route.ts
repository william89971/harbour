import { NextResponse } from "next/server";
import { withAuth, withOperator } from "@/lib/auth";
import {
  listTasksAsync,
  createTaskAsync,
  TASK_STATUSES,
  TASK_PRIORITIES,
  TASK_OWNER_TYPES,
  type TaskStatus,
  type TaskPriority,
  type TaskOwnerType,
} from "@/lib/db/tasks";

function isTaskStatus(v: unknown): v is TaskStatus {
  return typeof v === "string" && (TASK_STATUSES as string[]).includes(v);
}
function isTaskPriority(v: unknown): v is TaskPriority {
  return typeof v === "string" && (TASK_PRIORITIES as string[]).includes(v);
}
function isTaskOwnerType(v: unknown): v is TaskOwnerType {
  return typeof v === "string" && (TASK_OWNER_TYPES as string[]).includes(v);
}

export const GET = withAuth(async (req) => {
  const statusParam = req.nextUrl.searchParams.get("status");
  const goalId = req.nextUrl.searchParams.get("goal_id") || undefined;
  let statuses: TaskStatus[] | undefined;
  if (statusParam) {
    const candidates = statusParam.split(",").map(s => s.trim()).filter(Boolean);
    statuses = candidates.filter(isTaskStatus);
    if (statuses.length === 0) statuses = undefined;
  }
  return NextResponse.json(await listTasksAsync({ statuses, goalId }));
});

export const POST = withOperator(async (req) => {
  const body = await req.json();
  if (!body.title || typeof body.title !== "string") {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (body.status !== undefined && !isTaskStatus(body.status)) {
    return NextResponse.json({ error: `status must be one of ${TASK_STATUSES.join(", ")}` }, { status: 400 });
  }
  if (body.priority !== undefined && !isTaskPriority(body.priority)) {
    return NextResponse.json({ error: `priority must be one of ${TASK_PRIORITIES.join(", ")}` }, { status: 400 });
  }
  if (body.owner_type !== undefined && !isTaskOwnerType(body.owner_type)) {
    return NextResponse.json({ error: `owner_type must be one of ${TASK_OWNER_TYPES.join(", ")}` }, { status: 400 });
  }
  const task = await createTaskAsync({
    title: body.title,
    notes: body.notes ?? null,
    status: body.status,
    priority: body.priority,
    ownerType: body.owner_type,
    ownerId: body.owner_id ?? null,
    goalId: body.goal_id ?? null,
    dueDate: body.due_date ?? null,
  });
  return NextResponse.json(task, { status: 201 });
});
