import { getDb, getDbAsync } from "./schema";
import { nowSql } from "./dialect";
import { v4 as uuid } from "uuid";
import { encrypt, decrypt } from "../encryption";

type EnvVarRow = { id: string; name: string; pinned: number; created_at: number; updated_at: number };

export function createEnvVar(name: string, value: string) {
  const db = getDb();
  const id = uuid();
  const encrypted = encrypt(value);
  db.prepare(
    `INSERT INTO env_vars (id, name, encrypted_value) VALUES (?, ?, ?)`
  ).run(id, name, encrypted);
  return getEnvVarById(id);
}

export function getEnvVarById(id: string) {
  const db = getDb();
  return db.prepare(
    `SELECT id, name, pinned, created_at, updated_at FROM env_vars WHERE id = ?`
  ).get(id) as any || null;
}

export function listEnvVars(projectId?: string) {
  const db = getDb();
  if (projectId) {
    return db.prepare(
      `SELECT id, name, pinned, created_at, updated_at FROM env_vars
       WHERE id IN (SELECT env_var_id FROM project_env_vars WHERE project_id = ?)
       ORDER BY pinned DESC, name ASC`
    ).all(projectId);
  }
  return db.prepare(
    `SELECT id, name, pinned, created_at, updated_at FROM env_vars ORDER BY pinned DESC, name ASC`
  ).all();
}

export function updateEnvVar(id: string, data: { name?: string; value?: string }) {
  const db = getDb();
  const fields: string[] = [];
  const values: any[] = [];
  if (data.name !== undefined) { fields.push("name = ?"); values.push(data.name); }
  if (data.value !== undefined) { fields.push("encrypted_value = ?"); values.push(encrypt(data.value)); }
  if (fields.length === 0) return getEnvVarById(id);
  fields.push("updated_at = unixepoch()");
  values.push(id);
  db.prepare(`UPDATE env_vars SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getEnvVarById(id);
}

export function deleteEnvVar(id: string) {
  const db = getDb();
  db.prepare(`DELETE FROM env_vars WHERE id = ?`).run(id);
}

export function toggleEnvVarPinned(id: string) {
  const db = getDb();
  db.prepare(`UPDATE env_vars SET pinned = CASE WHEN pinned = 1 THEN 0 ELSE 1 END, updated_at = unixepoch() WHERE id = ?`).run(id);
  return getEnvVarById(id);
}

export function getEnvVarDecryptedValue(id: string): string | null {
  const db = getDb();
  const row = db.prepare(`SELECT encrypted_value FROM env_vars WHERE id = ?`).get(id) as any;
  if (!row) return null;
  return decrypt(row.encrypted_value);
}

export function listPinnedEnvVarIds(): string[] {
  const db = getDb();
  return (db.prepare(`SELECT id FROM env_vars WHERE pinned = 1`).all() as { id: string }[]).map(r => r.id);
}

// Link/unlink env vars to jobs
export function linkEnvVarToJob(jobId: string, envVarId: string) {
  const db = getDb();
  db.prepare(`INSERT OR IGNORE INTO job_env_vars (job_id, env_var_id) VALUES (?, ?)`).run(jobId, envVarId);
}

export function unlinkEnvVarFromJob(jobId: string, envVarId: string) {
  const db = getDb();
  db.prepare(`DELETE FROM job_env_vars WHERE job_id = ? AND env_var_id = ?`).run(jobId, envVarId);
}

// Decrypt all env vars for a job (used by /next payload)
export function getDecryptedEnvVarsForJob(jobId: string): Record<string, string> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT ev.name, ev.encrypted_value
    FROM job_env_vars jev
    JOIN env_vars ev ON jev.env_var_id = ev.id
    WHERE jev.job_id = ?
  `).all(jobId) as { name: string; encrypted_value: string }[];

  const env: Record<string, string> = {};
  for (const row of rows) {
    env[row.name] = decrypt(row.encrypted_value);
  }
  return env;
}

// ---------------------------------------------------------------------------
// Async variants — cross-backend (SQLite + Postgres) via the adapter layer.
// ---------------------------------------------------------------------------

export async function createEnvVarAsync(name: string, value: string) {
  const db = await getDbAsync();
  const id = uuid();
  await db.run(`INSERT INTO env_vars (id, name, encrypted_value) VALUES (?, ?, ?)`, [id, name, encrypt(value)]);
  return getEnvVarByIdAsync(id);
}

export async function getEnvVarByIdAsync(id: string) {
  const db = await getDbAsync();
  return db.get<EnvVarRow>(`SELECT id, name, pinned, created_at, updated_at FROM env_vars WHERE id = ?`, [id]);
}

export async function listEnvVarsAsync(projectId?: string) {
  const db = await getDbAsync();
  if (projectId) {
    return db.all<EnvVarRow>(
      `SELECT id, name, pinned, created_at, updated_at FROM env_vars
       WHERE id IN (SELECT env_var_id FROM project_env_vars WHERE project_id = ?)
       ORDER BY pinned DESC, name ASC`,
      [projectId],
    );
  }
  return db.all<EnvVarRow>(`SELECT id, name, pinned, created_at, updated_at FROM env_vars ORDER BY pinned DESC, name ASC`);
}

export async function updateEnvVarAsync(id: string, data: { name?: string; value?: string }) {
  const db = await getDbAsync();
  const fields: string[] = [];
  const values: (string | number)[] = [];
  if (data.name !== undefined) { fields.push("name = ?"); values.push(data.name); }
  if (data.value !== undefined) { fields.push("encrypted_value = ?"); values.push(encrypt(data.value)); }
  if (fields.length === 0) return getEnvVarByIdAsync(id);
  fields.push(`updated_at = ${nowSql(db)}`);
  values.push(id);
  await db.run(`UPDATE env_vars SET ${fields.join(", ")} WHERE id = ?`, values);
  return getEnvVarByIdAsync(id);
}

export async function deleteEnvVarAsync(id: string) {
  const db = await getDbAsync();
  await db.run(`DELETE FROM env_vars WHERE id = ?`, [id]);
}

export async function toggleEnvVarPinnedAsync(id: string) {
  const db = await getDbAsync();
  await db.run(
    `UPDATE env_vars SET pinned = CASE WHEN pinned = 1 THEN 0 ELSE 1 END, updated_at = ${nowSql(db)} WHERE id = ?`,
    [id],
  );
  return getEnvVarByIdAsync(id);
}

export async function getEnvVarDecryptedValueAsync(id: string): Promise<string | null> {
  const db = await getDbAsync();
  const row = await db.get<{ encrypted_value: string }>(`SELECT encrypted_value FROM env_vars WHERE id = ?`, [id]);
  if (!row) return null;
  return decrypt(row.encrypted_value);
}

export async function listPinnedEnvVarIdsAsync(): Promise<string[]> {
  const db = await getDbAsync();
  const rows = await db.all<{ id: string }>(`SELECT id FROM env_vars WHERE pinned = 1`);
  return rows.map(r => r.id);
}

export async function linkEnvVarToJobAsync(jobId: string, envVarId: string) {
  const db = await getDbAsync();
  await db.run(`INSERT INTO job_env_vars (job_id, env_var_id) VALUES (?, ?) ON CONFLICT DO NOTHING`, [jobId, envVarId]);
}

export async function unlinkEnvVarFromJobAsync(jobId: string, envVarId: string) {
  const db = await getDbAsync();
  await db.run(`DELETE FROM job_env_vars WHERE job_id = ? AND env_var_id = ?`, [jobId, envVarId]);
}

export async function getDecryptedEnvVarsForJobAsync(jobId: string): Promise<Record<string, string>> {
  const db = await getDbAsync();
  const rows = await db.all<{ name: string; encrypted_value: string }>(
    `SELECT ev.name, ev.encrypted_value
     FROM job_env_vars jev
     JOIN env_vars ev ON jev.env_var_id = ev.id
     WHERE jev.job_id = ?`,
    [jobId],
  );
  const env: Record<string, string> = {};
  for (const row of rows) env[row.name] = decrypt(row.encrypted_value);
  return env;
}
