import { getDb, getDbAsync } from "./schema";
import { nowSql } from "./dialect";
import { v4 as uuid } from "uuid";

type ProjectRow = { id: string; name: string; created_at: number; updated_at: number };

// --- Project CRUD ---

export function createProject(name: string) {
  const db = getDb();
  const id = uuid();
  db.prepare(`INSERT INTO projects (id, name) VALUES (?, ?)`).run(id, name);
  return getProjectById(id);
}

export function getProjectById(id: string) {
  const db = getDb();
  return db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id) as any || null;
}

export function listProjects() {
  const db = getDb();
  return db.prepare(`SELECT * FROM projects ORDER BY name ASC`).all();
}

export function updateProject(id: string, data: { name?: string }) {
  const db = getDb();
  const fields: string[] = [];
  const values: any[] = [];
  if (data.name !== undefined) { fields.push("name = ?"); values.push(data.name); }
  if (fields.length === 0) return getProjectById(id);
  fields.push("updated_at = unixepoch()");
  values.push(id);
  db.prepare(`UPDATE projects SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getProjectById(id);
}

export function deleteProject(id: string) {
  const db = getDb();
  db.prepare(`DELETE FROM projects WHERE id = ?`).run(id);
}

// --- Linking: Agents ---

export function linkAgentToProject(projectId: string, agentId: string) {
  const db = getDb();
  db.prepare(`INSERT OR IGNORE INTO project_agents (project_id, agent_id) VALUES (?, ?)`).run(projectId, agentId);
}

export function unlinkAgentFromProject(projectId: string, agentId: string) {
  const db = getDb();
  db.prepare(`DELETE FROM project_agents WHERE project_id = ? AND agent_id = ?`).run(projectId, agentId);
}

export function listAgentIdsForProject(projectId: string): string[] {
  const db = getDb();
  return (db.prepare(`SELECT agent_id FROM project_agents WHERE project_id = ?`).all(projectId) as { agent_id: string }[]).map(r => r.agent_id);
}

// --- Linking: Jobs ---

export function linkJobToProject(projectId: string, jobId: string) {
  const db = getDb();

  db.transaction(() => {
    // Link the job itself
    db.prepare(`INSERT OR IGNORE INTO project_jobs (project_id, job_id) VALUES (?, ?)`).run(projectId, jobId);

    // Auto-link the job's agent
    const job = db.prepare(`SELECT agent_id FROM jobs WHERE id = ?`).get(jobId) as { agent_id: string } | undefined;
    if (job) {
      db.prepare(`INSERT OR IGNORE INTO project_agents (project_id, agent_id) VALUES (?, ?)`).run(projectId, job.agent_id);
    }

    // Auto-link the job's docs
    const docs = db.prepare(`SELECT doc_id FROM job_docs WHERE job_id = ?`).all(jobId) as { doc_id: string }[];
    for (const d of docs) {
      db.prepare(`INSERT OR IGNORE INTO project_docs (project_id, doc_id) VALUES (?, ?)`).run(projectId, d.doc_id);
    }

    // Auto-link the job's env vars
    const envVars = db.prepare(`SELECT env_var_id FROM job_env_vars WHERE job_id = ?`).all(jobId) as { env_var_id: string }[];
    for (const ev of envVars) {
      db.prepare(`INSERT OR IGNORE INTO project_env_vars (project_id, env_var_id) VALUES (?, ?)`).run(projectId, ev.env_var_id);
    }

    // Auto-link the job's databases
    const databases = db.prepare(`SELECT database_id FROM job_databases WHERE job_id = ?`).all(jobId) as { database_id: string }[];
    for (const d of databases) {
      db.prepare(`INSERT OR IGNORE INTO project_databases (project_id, database_id) VALUES (?, ?)`).run(projectId, d.database_id);
    }
  })();
}

export function unlinkJobFromProject(projectId: string, jobId: string) {
  const db = getDb();
  db.prepare(`DELETE FROM project_jobs WHERE project_id = ? AND job_id = ?`).run(projectId, jobId);
}

export function listJobIdsForProject(projectId: string): string[] {
  const db = getDb();
  return (db.prepare(`SELECT job_id FROM project_jobs WHERE project_id = ?`).all(projectId) as { job_id: string }[]).map(r => r.job_id);
}

// --- Linking: Docs ---

export function linkDocToProject(projectId: string, docId: string) {
  const db = getDb();
  db.prepare(`INSERT OR IGNORE INTO project_docs (project_id, doc_id) VALUES (?, ?)`).run(projectId, docId);
}

export function unlinkDocFromProject(projectId: string, docId: string) {
  const db = getDb();
  db.prepare(`DELETE FROM project_docs WHERE project_id = ? AND doc_id = ?`).run(projectId, docId);
}

export function listDocIdsForProject(projectId: string): string[] {
  const db = getDb();
  return (db.prepare(`SELECT doc_id FROM project_docs WHERE project_id = ?`).all(projectId) as { doc_id: string }[]).map(r => r.doc_id);
}

// --- Linking: Env Vars ---

export function linkEnvVarToProject(projectId: string, envVarId: string) {
  const db = getDb();
  db.prepare(`INSERT OR IGNORE INTO project_env_vars (project_id, env_var_id) VALUES (?, ?)`).run(projectId, envVarId);
}

export function unlinkEnvVarFromProject(projectId: string, envVarId: string) {
  const db = getDb();
  db.prepare(`DELETE FROM project_env_vars WHERE project_id = ? AND env_var_id = ?`).run(projectId, envVarId);
}

export function listEnvVarIdsForProject(projectId: string): string[] {
  const db = getDb();
  return (db.prepare(`SELECT env_var_id FROM project_env_vars WHERE project_id = ?`).all(projectId) as { env_var_id: string }[]).map(r => r.env_var_id);
}

// --- Linking: Databases ---

export function linkDatabaseToProject(projectId: string, databaseId: string) {
  const db = getDb();
  db.prepare(`INSERT OR IGNORE INTO project_databases (project_id, database_id) VALUES (?, ?)`).run(projectId, databaseId);
}

export function unlinkDatabaseFromProject(projectId: string, databaseId: string) {
  const db = getDb();
  db.prepare(`DELETE FROM project_databases WHERE project_id = ? AND database_id = ?`).run(projectId, databaseId);
}

export function listDatabaseIdsForProject(projectId: string): string[] {
  const db = getDb();
  return (db.prepare(`SELECT database_id FROM project_databases WHERE project_id = ?`).all(projectId) as { database_id: string }[]).map(r => r.database_id);
}

// ---------------------------------------------------------------------------
// Async variants — cross-backend (SQLite + Postgres) via the adapter layer.
// ---------------------------------------------------------------------------

export async function createProjectAsync(name: string) {
  const db = await getDbAsync();
  const id = uuid();
  await db.run(`INSERT INTO projects (id, name) VALUES (?, ?)`, [id, name]);
  return getProjectByIdAsync(id);
}

export async function getProjectByIdAsync(id: string) {
  const db = await getDbAsync();
  return db.get<ProjectRow>(`SELECT * FROM projects WHERE id = ?`, [id]);
}

export async function listProjectsAsync() {
  const db = await getDbAsync();
  return db.all<ProjectRow>(`SELECT * FROM projects ORDER BY name ASC`);
}

export async function updateProjectAsync(id: string, data: { name?: string }) {
  const db = await getDbAsync();
  const fields: string[] = [];
  const values: (string | number)[] = [];
  if (data.name !== undefined) { fields.push("name = ?"); values.push(data.name); }
  if (fields.length === 0) return getProjectByIdAsync(id);
  fields.push(`updated_at = ${nowSql(db)}`);
  values.push(id);
  await db.run(`UPDATE projects SET ${fields.join(", ")} WHERE id = ?`, values);
  return getProjectByIdAsync(id);
}

export async function deleteProjectAsync(id: string) {
  const db = await getDbAsync();
  await db.run(`DELETE FROM projects WHERE id = ?`, [id]);
}

export async function linkAgentToProjectAsync(projectId: string, agentId: string) {
  const db = await getDbAsync();
  await db.run(`INSERT INTO project_agents (project_id, agent_id) VALUES (?, ?) ON CONFLICT DO NOTHING`, [projectId, agentId]);
}

export async function unlinkAgentFromProjectAsync(projectId: string, agentId: string) {
  const db = await getDbAsync();
  await db.run(`DELETE FROM project_agents WHERE project_id = ? AND agent_id = ?`, [projectId, agentId]);
}

export async function listAgentIdsForProjectAsync(projectId: string): Promise<string[]> {
  const db = await getDbAsync();
  const rows = await db.all<{ agent_id: string }>(`SELECT agent_id FROM project_agents WHERE project_id = ?`, [projectId]);
  return rows.map(r => r.agent_id);
}

export async function linkJobToProjectAsync(projectId: string, jobId: string) {
  const db = await getDbAsync();
  await db.transaction(async (tx) => {
    await tx.run(`INSERT INTO project_jobs (project_id, job_id) VALUES (?, ?) ON CONFLICT DO NOTHING`, [projectId, jobId]);

    const job = await tx.get<{ agent_id: string | null }>(`SELECT agent_id FROM jobs WHERE id = ?`, [jobId]);
    if (job && job.agent_id) {
      await tx.run(`INSERT INTO project_agents (project_id, agent_id) VALUES (?, ?) ON CONFLICT DO NOTHING`, [projectId, job.agent_id]);
    }

    const docs = await tx.all<{ doc_id: string }>(`SELECT doc_id FROM job_docs WHERE job_id = ?`, [jobId]);
    for (const d of docs) {
      await tx.run(`INSERT INTO project_docs (project_id, doc_id) VALUES (?, ?) ON CONFLICT DO NOTHING`, [projectId, d.doc_id]);
    }

    const envVars = await tx.all<{ env_var_id: string }>(`SELECT env_var_id FROM job_env_vars WHERE job_id = ?`, [jobId]);
    for (const ev of envVars) {
      await tx.run(`INSERT INTO project_env_vars (project_id, env_var_id) VALUES (?, ?) ON CONFLICT DO NOTHING`, [projectId, ev.env_var_id]);
    }

    const databases = await tx.all<{ database_id: string }>(`SELECT database_id FROM job_databases WHERE job_id = ?`, [jobId]);
    for (const d of databases) {
      await tx.run(`INSERT INTO project_databases (project_id, database_id) VALUES (?, ?) ON CONFLICT DO NOTHING`, [projectId, d.database_id]);
    }
  });
}

export async function unlinkJobFromProjectAsync(projectId: string, jobId: string) {
  const db = await getDbAsync();
  await db.run(`DELETE FROM project_jobs WHERE project_id = ? AND job_id = ?`, [projectId, jobId]);
}

export async function listJobIdsForProjectAsync(projectId: string): Promise<string[]> {
  const db = await getDbAsync();
  const rows = await db.all<{ job_id: string }>(`SELECT job_id FROM project_jobs WHERE project_id = ?`, [projectId]);
  return rows.map(r => r.job_id);
}

export async function linkDocToProjectAsync(projectId: string, docId: string) {
  const db = await getDbAsync();
  await db.run(`INSERT INTO project_docs (project_id, doc_id) VALUES (?, ?) ON CONFLICT DO NOTHING`, [projectId, docId]);
}

export async function unlinkDocFromProjectAsync(projectId: string, docId: string) {
  const db = await getDbAsync();
  await db.run(`DELETE FROM project_docs WHERE project_id = ? AND doc_id = ?`, [projectId, docId]);
}

export async function listDocIdsForProjectAsync(projectId: string): Promise<string[]> {
  const db = await getDbAsync();
  const rows = await db.all<{ doc_id: string }>(`SELECT doc_id FROM project_docs WHERE project_id = ?`, [projectId]);
  return rows.map(r => r.doc_id);
}

export async function linkEnvVarToProjectAsync(projectId: string, envVarId: string) {
  const db = await getDbAsync();
  await db.run(`INSERT INTO project_env_vars (project_id, env_var_id) VALUES (?, ?) ON CONFLICT DO NOTHING`, [projectId, envVarId]);
}

export async function unlinkEnvVarFromProjectAsync(projectId: string, envVarId: string) {
  const db = await getDbAsync();
  await db.run(`DELETE FROM project_env_vars WHERE project_id = ? AND env_var_id = ?`, [projectId, envVarId]);
}

export async function listEnvVarIdsForProjectAsync(projectId: string): Promise<string[]> {
  const db = await getDbAsync();
  const rows = await db.all<{ env_var_id: string }>(`SELECT env_var_id FROM project_env_vars WHERE project_id = ?`, [projectId]);
  return rows.map(r => r.env_var_id);
}

export async function linkDatabaseToProjectAsync(projectId: string, databaseId: string) {
  const db = await getDbAsync();
  await db.run(`INSERT INTO project_databases (project_id, database_id) VALUES (?, ?) ON CONFLICT DO NOTHING`, [projectId, databaseId]);
}

export async function unlinkDatabaseFromProjectAsync(projectId: string, databaseId: string) {
  const db = await getDbAsync();
  await db.run(`DELETE FROM project_databases WHERE project_id = ? AND database_id = ?`, [projectId, databaseId]);
}

export async function listDatabaseIdsForProjectAsync(projectId: string): Promise<string[]> {
  const db = await getDbAsync();
  const rows = await db.all<{ database_id: string }>(`SELECT database_id FROM project_databases WHERE project_id = ?`, [projectId]);
  return rows.map(r => r.database_id);
}
