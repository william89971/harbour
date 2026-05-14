import { getDb, getDbAsync } from "./schema";
import { nowSql } from "./dialect";
import { v4 as uuid } from "uuid";

export type GoalStatus = "active" | "paused" | "completed" | "archived";
export type GoalPriority = "low" | "medium" | "high";

export const GOAL_STATUSES: GoalStatus[] = ["active", "paused", "completed", "archived"];
export const GOAL_PRIORITIES: GoalPriority[] = ["low", "medium", "high"];

export type GoalRow = {
  id: string;
  title: string;
  notes: string | null;
  status: GoalStatus;
  priority: GoalPriority;
  target_date: number | null;
  created_at: number;
  updated_at: number;
};

export type CreateGoalInput = {
  title: string;
  notes?: string | null;
  status?: GoalStatus;
  priority?: GoalPriority;
  targetDate?: number | null;
};

export type UpdateGoalInput = {
  title?: string;
  notes?: string | null;
  status?: GoalStatus;
  priority?: GoalPriority;
  targetDate?: number | null;
};

// ---------------------------------------------------------------------------
// Sync helpers (better-sqlite3)
// ---------------------------------------------------------------------------

export function createGoal(input: CreateGoalInput): GoalRow {
  const db = getDb();
  const id = uuid();
  db.prepare(
    `INSERT INTO goals (id, title, notes, status, priority, target_date) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.title,
    input.notes ?? null,
    input.status ?? "active",
    input.priority ?? "medium",
    input.targetDate ?? null,
  );
  return getGoalById(id)!;
}

export function getGoalById(id: string): GoalRow | null {
  const db = getDb();
  return (db.prepare(`SELECT * FROM goals WHERE id = ?`).get(id) as GoalRow | undefined) ?? null;
}

export function listGoals(status?: GoalStatus): GoalRow[] {
  const db = getDb();
  if (status) {
    return db.prepare(`SELECT * FROM goals WHERE status = ? ORDER BY updated_at DESC`).all(status) as GoalRow[];
  }
  return db.prepare(`SELECT * FROM goals ORDER BY status = 'active' DESC, updated_at DESC`).all() as GoalRow[];
}

export function updateGoal(id: string, input: UpdateGoalInput): GoalRow | null {
  const db = getDb();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  if (input.title !== undefined) { fields.push("title = ?"); values.push(input.title); }
  if (input.notes !== undefined) { fields.push("notes = ?"); values.push(input.notes); }
  if (input.status !== undefined) { fields.push("status = ?"); values.push(input.status); }
  if (input.priority !== undefined) { fields.push("priority = ?"); values.push(input.priority); }
  if (input.targetDate !== undefined) { fields.push("target_date = ?"); values.push(input.targetDate); }
  if (fields.length === 0) return getGoalById(id);
  fields.push("updated_at = unixepoch()");
  values.push(id);
  db.prepare(`UPDATE goals SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getGoalById(id);
}

export function deleteGoal(id: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM goals WHERE id = ?`).run(id);
}

// ---------------------------------------------------------------------------
// Async helpers (cross-backend SQLite + Postgres)
// ---------------------------------------------------------------------------

export async function createGoalAsync(input: CreateGoalInput): Promise<GoalRow> {
  const db = await getDbAsync();
  const id = uuid();
  await db.run(
    `INSERT INTO goals (id, title, notes, status, priority, target_date) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.title,
      input.notes ?? null,
      input.status ?? "active",
      input.priority ?? "medium",
      input.targetDate ?? null,
    ],
  );
  return (await getGoalByIdAsync(id))!;
}

export async function getGoalByIdAsync(id: string): Promise<GoalRow | null> {
  const db = await getDbAsync();
  const row = await db.get<GoalRow>(`SELECT * FROM goals WHERE id = ?`, [id]);
  return row ?? null;
}

export async function listGoalsAsync(status?: GoalStatus): Promise<GoalRow[]> {
  const db = await getDbAsync();
  if (status) {
    return db.all<GoalRow>(`SELECT * FROM goals WHERE status = ? ORDER BY updated_at DESC`, [status]);
  }
  // Active first, then everything else by updated_at desc.
  return db.all<GoalRow>(
    `SELECT * FROM goals ORDER BY (CASE WHEN status = 'active' THEN 0 ELSE 1 END), updated_at DESC`,
  );
}

export async function updateGoalAsync(id: string, input: UpdateGoalInput): Promise<GoalRow | null> {
  const db = await getDbAsync();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  if (input.title !== undefined) { fields.push("title = ?"); values.push(input.title); }
  if (input.notes !== undefined) { fields.push("notes = ?"); values.push(input.notes); }
  if (input.status !== undefined) { fields.push("status = ?"); values.push(input.status); }
  if (input.priority !== undefined) { fields.push("priority = ?"); values.push(input.priority); }
  if (input.targetDate !== undefined) { fields.push("target_date = ?"); values.push(input.targetDate); }
  if (fields.length === 0) return getGoalByIdAsync(id);
  fields.push(`updated_at = ${nowSql(db)}`);
  values.push(id);
  await db.run(`UPDATE goals SET ${fields.join(", ")} WHERE id = ?`, values);
  return getGoalByIdAsync(id);
}

export async function deleteGoalAsync(id: string): Promise<void> {
  const db = await getDbAsync();
  await db.run(`DELETE FROM goals WHERE id = ?`, [id]);
}

export async function countGoalsAsync(status?: GoalStatus): Promise<number> {
  const db = await getDbAsync();
  if (status) {
    const row = await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM goals WHERE status = ?`, [status]);
    return Number(row?.n ?? 0);
  }
  const row = await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM goals`);
  return Number(row?.n ?? 0);
}
