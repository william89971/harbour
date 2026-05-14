import { getDb, getDbAsync } from "./schema";
import { nowSql } from "./dialect";
import { v4 as uuid } from "uuid";

export type TaskStatus = "todo" | "doing" | "blocked" | "done" | "archived";
export type TaskPriority = "low" | "medium" | "high";
export type TaskOwnerType = "user" | "agent" | "none";

export const TASK_STATUSES: TaskStatus[] = ["todo", "doing", "blocked", "done", "archived"];
export const TASK_PRIORITIES: TaskPriority[] = ["low", "medium", "high"];
export const TASK_OWNER_TYPES: TaskOwnerType[] = ["user", "agent", "none"];

export type TaskRow = {
  id: string;
  title: string;
  notes: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  owner_type: TaskOwnerType;
  owner_id: string | null;
  goal_id: string | null;
  due_date: number | null;
  created_at: number;
  updated_at: number;
};

export type TaskRowWithGoal = TaskRow & { goal_title: string | null };

export type CreateTaskInput = {
  title: string;
  notes?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  ownerType?: TaskOwnerType;
  ownerId?: string | null;
  goalId?: string | null;
  dueDate?: number | null;
};

export type UpdateTaskInput = {
  title?: string;
  notes?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  ownerType?: TaskOwnerType;
  ownerId?: string | null;
  goalId?: string | null;
  dueDate?: number | null;
};

export type ListTaskFilter = {
  statuses?: TaskStatus[];
  goalId?: string;
};

// ---------------------------------------------------------------------------
// Sync helpers
// ---------------------------------------------------------------------------

export function createTask(input: CreateTaskInput): TaskRow {
  const db = getDb();
  const id = uuid();
  db.prepare(
    `INSERT INTO tasks (id, title, notes, status, priority, owner_type, owner_id, goal_id, due_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.title,
    input.notes ?? null,
    input.status ?? "todo",
    input.priority ?? "medium",
    input.ownerType ?? "none",
    input.ownerId ?? null,
    input.goalId ?? null,
    input.dueDate ?? null,
  );
  return getTaskById(id)!;
}

export function getTaskById(id: string): TaskRow | null {
  const db = getDb();
  return (db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as TaskRow | undefined) ?? null;
}

export function listTasks(filter: ListTaskFilter = {}): TaskRowWithGoal[] {
  const db = getDb();
  const where: string[] = [];
  const values: (string | number)[] = [];
  if (filter.statuses && filter.statuses.length > 0) {
    where.push(`t.status IN (${filter.statuses.map(() => "?").join(", ")})`);
    values.push(...filter.statuses);
  }
  if (filter.goalId) {
    where.push("t.goal_id = ?");
    values.push(filter.goalId);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return db.prepare(`
    SELECT t.*, g.title AS goal_title
    FROM tasks t
    LEFT JOIN goals g ON g.id = t.goal_id
    ${whereSql}
    ORDER BY
      CASE t.status WHEN 'doing' THEN 0 WHEN 'blocked' THEN 1 WHEN 'todo' THEN 2 WHEN 'done' THEN 3 ELSE 4 END,
      t.updated_at DESC
  `).all(...values) as TaskRowWithGoal[];
}

export function updateTask(id: string, input: UpdateTaskInput): TaskRow | null {
  const db = getDb();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  if (input.title !== undefined) { fields.push("title = ?"); values.push(input.title); }
  if (input.notes !== undefined) { fields.push("notes = ?"); values.push(input.notes); }
  if (input.status !== undefined) { fields.push("status = ?"); values.push(input.status); }
  if (input.priority !== undefined) { fields.push("priority = ?"); values.push(input.priority); }
  if (input.ownerType !== undefined) { fields.push("owner_type = ?"); values.push(input.ownerType); }
  if (input.ownerId !== undefined) { fields.push("owner_id = ?"); values.push(input.ownerId); }
  if (input.goalId !== undefined) { fields.push("goal_id = ?"); values.push(input.goalId); }
  if (input.dueDate !== undefined) { fields.push("due_date = ?"); values.push(input.dueDate); }
  if (fields.length === 0) return getTaskById(id);
  fields.push("updated_at = unixepoch()");
  values.push(id);
  db.prepare(`UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getTaskById(id);
}

export function deleteTask(id: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM tasks WHERE id = ?`).run(id);
}

// ---------------------------------------------------------------------------
// Async helpers
// ---------------------------------------------------------------------------

export async function createTaskAsync(input: CreateTaskInput): Promise<TaskRow> {
  const db = await getDbAsync();
  const id = uuid();
  await db.run(
    `INSERT INTO tasks (id, title, notes, status, priority, owner_type, owner_id, goal_id, due_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.title,
      input.notes ?? null,
      input.status ?? "todo",
      input.priority ?? "medium",
      input.ownerType ?? "none",
      input.ownerId ?? null,
      input.goalId ?? null,
      input.dueDate ?? null,
    ],
  );
  return (await getTaskByIdAsync(id))!;
}

export async function getTaskByIdAsync(id: string): Promise<TaskRow | null> {
  const db = await getDbAsync();
  const row = await db.get<TaskRow>(`SELECT * FROM tasks WHERE id = ?`, [id]);
  return row ?? null;
}

export async function listTasksAsync(filter: ListTaskFilter = {}): Promise<TaskRowWithGoal[]> {
  const db = await getDbAsync();
  const where: string[] = [];
  const values: (string | number)[] = [];
  if (filter.statuses && filter.statuses.length > 0) {
    where.push(`t.status IN (${filter.statuses.map(() => "?").join(", ")})`);
    values.push(...filter.statuses);
  }
  if (filter.goalId) {
    where.push("t.goal_id = ?");
    values.push(filter.goalId);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return db.all<TaskRowWithGoal>(
    `SELECT t.*, g.title AS goal_title
     FROM tasks t
     LEFT JOIN goals g ON g.id = t.goal_id
     ${whereSql}
     ORDER BY
       CASE t.status WHEN 'doing' THEN 0 WHEN 'blocked' THEN 1 WHEN 'todo' THEN 2 WHEN 'done' THEN 3 ELSE 4 END,
       t.updated_at DESC`,
    values,
  );
}

export async function updateTaskAsync(id: string, input: UpdateTaskInput): Promise<TaskRow | null> {
  const db = await getDbAsync();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  if (input.title !== undefined) { fields.push("title = ?"); values.push(input.title); }
  if (input.notes !== undefined) { fields.push("notes = ?"); values.push(input.notes); }
  if (input.status !== undefined) { fields.push("status = ?"); values.push(input.status); }
  if (input.priority !== undefined) { fields.push("priority = ?"); values.push(input.priority); }
  if (input.ownerType !== undefined) { fields.push("owner_type = ?"); values.push(input.ownerType); }
  if (input.ownerId !== undefined) { fields.push("owner_id = ?"); values.push(input.ownerId); }
  if (input.goalId !== undefined) { fields.push("goal_id = ?"); values.push(input.goalId); }
  if (input.dueDate !== undefined) { fields.push("due_date = ?"); values.push(input.dueDate); }
  if (fields.length === 0) return getTaskByIdAsync(id);
  fields.push(`updated_at = ${nowSql(db)}`);
  values.push(id);
  await db.run(`UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`, values);
  return getTaskByIdAsync(id);
}

export async function deleteTaskAsync(id: string): Promise<void> {
  const db = await getDbAsync();
  await db.run(`DELETE FROM tasks WHERE id = ?`, [id]);
}

export async function countTasksByStatusAsync(statuses: TaskStatus[]): Promise<number> {
  if (statuses.length === 0) return 0;
  const db = await getDbAsync();
  const placeholders = statuses.map(() => "?").join(", ");
  const row = await db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM tasks WHERE status IN (${placeholders})`,
    statuses,
  );
  return Number(row?.n ?? 0);
}

export async function listTasksByGoalAsync(goalId: string): Promise<TaskRow[]> {
  const db = await getDbAsync();
  return db.all<TaskRow>(`SELECT * FROM tasks WHERE goal_id = ? ORDER BY updated_at DESC`, [goalId]);
}
