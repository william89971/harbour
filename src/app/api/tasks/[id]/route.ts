import { NextResponse } from "next/server";
import { withAuth, withOperator } from "@/lib/auth";
import {
  getTaskByIdAsync,
  updateTaskAsync,
  deleteTaskAsync,
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

export const GET = withAuth(async (_req, _auth, { params }) => {
  const { id } = await params;
  const task = await getTaskByIdAsync(id);
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  return NextResponse.json(task);
});

export const PUT = withOperator(async (req, _auth, { params }) => {
  const { id } = await params;
  const existing = await getTaskByIdAsync(id);
  if (!existing) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  const body = await req.json();
  if (body.status !== undefined && !isTaskStatus(body.status)) {
    return NextResponse.json({ error: `status must be one of ${TASK_STATUSES.join(", ")}` }, { status: 400 });
  }
  if (body.priority !== undefined && !isTaskPriority(body.priority)) {
    return NextResponse.json({ error: `priority must be one of ${TASK_PRIORITIES.join(", ")}` }, { status: 400 });
  }
  if (body.owner_type !== undefined && !isTaskOwnerType(body.owner_type)) {
    return NextResponse.json({ error: `owner_type must be one of ${TASK_OWNER_TYPES.join(", ")}` }, { status: 400 });
  }
  const updated = await updateTaskAsync(id, {
    title: body.title,
    notes: body.notes,
    status: body.status,
    priority: body.priority,
    ownerType: body.owner_type,
    ownerId: body.owner_id,
    goalId: body.goal_id,
    dueDate: body.due_date,
  });
  return NextResponse.json(updated);
});

export const DELETE = withOperator(async (_req, _auth, { params }) => {
  const { id } = await params;
  await deleteTaskAsync(id);
  return NextResponse.json({ ok: true });
});
