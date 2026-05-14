import { getDb, getDbAsync } from "./schema";
import { nowSql } from "./dialect";
import { v4 as uuid } from "uuid";

export type DecisionRow = {
  id: string;
  title: string;
  decision: string;
  rationale: string | null;
  consequences: string | null;
  created_at: number;
  updated_at: number;
};

export type CreateDecisionInput = {
  title: string;
  decision: string;
  rationale?: string | null;
  consequences?: string | null;
};

export type UpdateDecisionInput = {
  title?: string;
  decision?: string;
  rationale?: string | null;
  consequences?: string | null;
};

// ---------------------------------------------------------------------------
// Sync helpers
// ---------------------------------------------------------------------------

export function createDecision(input: CreateDecisionInput): DecisionRow {
  const db = getDb();
  const id = uuid();
  db.prepare(
    `INSERT INTO decisions (id, title, decision, rationale, consequences) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, input.title, input.decision, input.rationale ?? null, input.consequences ?? null);
  return getDecisionById(id)!;
}

export function getDecisionById(id: string): DecisionRow | null {
  const db = getDb();
  return (db.prepare(`SELECT * FROM decisions WHERE id = ?`).get(id) as DecisionRow | undefined) ?? null;
}

export function listDecisions(limit?: number): DecisionRow[] {
  const db = getDb();
  if (limit && limit > 0) {
    return db.prepare(`SELECT * FROM decisions ORDER BY created_at DESC LIMIT ?`).all(limit) as DecisionRow[];
  }
  return db.prepare(`SELECT * FROM decisions ORDER BY created_at DESC`).all() as DecisionRow[];
}

export function updateDecision(id: string, input: UpdateDecisionInput): DecisionRow | null {
  const db = getDb();
  const fields: string[] = [];
  const values: (string | null)[] = [];
  if (input.title !== undefined) { fields.push("title = ?"); values.push(input.title); }
  if (input.decision !== undefined) { fields.push("decision = ?"); values.push(input.decision); }
  if (input.rationale !== undefined) { fields.push("rationale = ?"); values.push(input.rationale); }
  if (input.consequences !== undefined) { fields.push("consequences = ?"); values.push(input.consequences); }
  if (fields.length === 0) return getDecisionById(id);
  fields.push("updated_at = unixepoch()");
  values.push(id);
  db.prepare(`UPDATE decisions SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getDecisionById(id);
}

export function deleteDecision(id: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM decisions WHERE id = ?`).run(id);
}

// ---------------------------------------------------------------------------
// Async helpers
// ---------------------------------------------------------------------------

export async function createDecisionAsync(input: CreateDecisionInput): Promise<DecisionRow> {
  const db = await getDbAsync();
  const id = uuid();
  await db.run(
    `INSERT INTO decisions (id, title, decision, rationale, consequences) VALUES (?, ?, ?, ?, ?)`,
    [id, input.title, input.decision, input.rationale ?? null, input.consequences ?? null],
  );
  return (await getDecisionByIdAsync(id))!;
}

export async function getDecisionByIdAsync(id: string): Promise<DecisionRow | null> {
  const db = await getDbAsync();
  const row = await db.get<DecisionRow>(`SELECT * FROM decisions WHERE id = ?`, [id]);
  return row ?? null;
}

export async function listDecisionsAsync(limit?: number): Promise<DecisionRow[]> {
  const db = await getDbAsync();
  if (limit && limit > 0) {
    return db.all<DecisionRow>(`SELECT * FROM decisions ORDER BY created_at DESC LIMIT ?`, [limit]);
  }
  return db.all<DecisionRow>(`SELECT * FROM decisions ORDER BY created_at DESC`);
}

export async function listRecentDecisionsAsync(limit: number = 5): Promise<DecisionRow[]> {
  return listDecisionsAsync(Math.max(1, Math.min(limit, 100)));
}

export async function updateDecisionAsync(id: string, input: UpdateDecisionInput): Promise<DecisionRow | null> {
  const db = await getDbAsync();
  const fields: string[] = [];
  const values: (string | null)[] = [];
  if (input.title !== undefined) { fields.push("title = ?"); values.push(input.title); }
  if (input.decision !== undefined) { fields.push("decision = ?"); values.push(input.decision); }
  if (input.rationale !== undefined) { fields.push("rationale = ?"); values.push(input.rationale); }
  if (input.consequences !== undefined) { fields.push("consequences = ?"); values.push(input.consequences); }
  if (fields.length === 0) return getDecisionByIdAsync(id);
  fields.push(`updated_at = ${nowSql(db)}`);
  values.push(id);
  await db.run(`UPDATE decisions SET ${fields.join(", ")} WHERE id = ?`, values);
  return getDecisionByIdAsync(id);
}

export async function deleteDecisionAsync(id: string): Promise<void> {
  const db = await getDbAsync();
  await db.run(`DELETE FROM decisions WHERE id = ?`, [id]);
}
