import { getDb, getDbAsync } from "./schema";
import { nowSql } from "./dialect";
import { v4 as uuid } from "uuid";
import { getNextRunTime } from "../schedule";
import { listPinnedDocIds, listPinnedDocIdsAsync } from "./docs";
import { listPinnedEnvVarIds, listPinnedEnvVarIdsAsync } from "./env-vars";
import { getTimezone, getTimezoneAsync } from "./settings";
import { deleteRunAttachmentsDir } from "./attachments";

type JobRow = {
  id: string; agent_id: string | null; team_id: string | null;
  preferred_role: string | null; role_fallback: string;
  agent_name?: string; team_name?: string | null; name: string;
  description: string | null; instructions: string | null; schedule: string;
  workflow_command: string | null; workflow_only: number; timeout_minutes: number;
  one_off: number; active: number; last_run_at: number | null; next_run_at: number | null;
  model: string | null; thinking: string | null; created_at: number; updated_at: number;
};

export type RoleFallback = "any" | "wait";

/** Validate a (agentId, teamId) pair — exactly one must be set unless workflowOnly. */
function validateAssignment(agentId: string | null, teamId: string | null | undefined, workflowOnly: boolean) {
  if (workflowOnly) {
    if (teamId) throw new Error("workflow-only jobs cannot be assigned to a team");
    return;
  }
  const hasAgent = !!agentId;
  const hasTeam = !!teamId;
  if (hasAgent && hasTeam) throw new Error("job cannot be assigned to both an agent and a team");
  if (!hasAgent && !hasTeam) throw new Error("job must be assigned to either an agent or a team");
}

/** Validate the role_fallback value. */
function validateRoleFallback(value: unknown): RoleFallback {
  if (value === undefined || value === null) return "any";
  if (value !== "any" && value !== "wait") {
    throw new Error("role_fallback must be 'any' or 'wait'");
  }
  return value;
}

export function createJob(agentId: string | null, data: {
  name: string;
  description?: string;
  instructions?: string;
  schedule: string;
  workflowCommand?: string;
  workflowOnly?: boolean;
  model?: string;
  thinking?: string;
  docIds?: string[];
  envVarIds?: string[];
  active?: boolean;
  teamId?: string | null;
  preferredRole?: string | null;
  roleFallback?: string | null;
}) {
  const db = getDb();
  const id = uuid();
  const nextRunAt = data.active !== false ? getNextRunTime(data.schedule, undefined, getTimezone()) : null;
  validateAssignment(agentId, data.teamId ?? null, !!data.workflowOnly);
  const roleFallback = validateRoleFallback(data.roleFallback);
  const preferredRole = data.preferredRole || null;

  const create = db.transaction(() => {
    db.prepare(`
      INSERT INTO jobs (id, agent_id, team_id, preferred_role, role_fallback, name, description, instructions, schedule, workflow_command, workflow_only, model, thinking, active, next_run_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, agentId, data.teamId || null, preferredRole, roleFallback,
      data.name, data.description || null,
      data.instructions || null, data.schedule,
      data.workflowCommand || null, data.workflowOnly ? 1 : 0,
      data.model || null, data.thinking || null,
      data.active !== false ? 1 : 0, nextRunAt
    );

    // Merge explicitly selected docs/env vars with pinned ones
    const allDocIds = new Set([...(data.docIds || []), ...listPinnedDocIds()]);
    if (allDocIds.size > 0) {
      const linkStmt = db.prepare(`INSERT OR IGNORE INTO job_docs (job_id, doc_id) VALUES (?, ?)`);
      for (const docId of allDocIds) linkStmt.run(id, docId);
    }
    const allEnvVarIds = new Set([...(data.envVarIds || []), ...listPinnedEnvVarIds()]);
    if (allEnvVarIds.size > 0) {
      const linkStmt = db.prepare(`INSERT OR IGNORE INTO job_env_vars (job_id, env_var_id) VALUES (?, ?)`);
      for (const envId of allEnvVarIds) linkStmt.run(id, envId);
    }
  });

  create();
  return getJobById(id);
}

export function getJobById(id: string) {
  const db = getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const job = db.prepare(`
    SELECT j.*, a.name as agent_name, t.name as team_name
    FROM jobs j
    LEFT JOIN agents a ON j.agent_id = a.id
    LEFT JOIN teams t ON j.team_id = t.id
    WHERE j.id = ?
  `).get(id) as any;
  if (!job) return null;

  const docs = db.prepare(`
    SELECT d.id, d.title FROM job_docs jd
    JOIN docs d ON jd.doc_id = d.id
    WHERE jd.job_id = ?
  `).all(id);

  const databases = db.prepare(`
    SELECT d.id, d.name, d.table_name FROM job_databases jd
    JOIN databases d ON jd.database_id = d.id
    WHERE jd.job_id = ?
  `).all(id);

  const envVars = db.prepare(`
    SELECT ev.id, ev.name FROM job_env_vars jev
    JOIN env_vars ev ON jev.env_var_id = ev.id
    WHERE jev.job_id = ?
  `).all(id);

  return { ...job, docs, databases, envVars };
}

export function listJobsByAgent(agentId: string) {
  const db = getDb();
  return db.prepare(`
    SELECT j.*,
      (SELECT COUNT(*) FROM runs WHERE job_id = j.id) as total_runs,
      (SELECT COUNT(*) FROM runs WHERE job_id = j.id AND status = 'waiting') as waiting_runs,
      (SELECT COUNT(*) FROM runs WHERE job_id = j.id AND status = 'pending') as pending_runs,
      (SELECT COUNT(*) FROM runs WHERE job_id = j.id AND status = 'skipped') as skipped_runs
    FROM jobs j WHERE j.agent_id = ? AND j.one_off = 0 ORDER BY j.name
  `).all(agentId);
}

export function listAllJobs(projectId?: string) {
  const db = getDb();
  if (projectId) {
    return db.prepare(`
      SELECT j.*, a.name as agent_name, t.name as team_name,
        (SELECT COUNT(*) FROM runs WHERE job_id = j.id AND status NOT IN ('skipped')) as total_runs,
        (SELECT COUNT(*) FROM runs WHERE job_id = j.id AND status = 'skipped') as skipped_runs,
        (SELECT COUNT(*) FROM runs WHERE job_id = j.id AND status = 'waiting') as waiting_runs,
        (SELECT COUNT(*) FROM runs WHERE job_id = j.id AND status = 'pending') as pending_runs,
        (SELECT COALESCE(SUM(rc.estimated_cost_usd), 0) FROM run_costs rc JOIN runs r ON rc.run_id = r.id WHERE r.job_id = j.id) as total_cost_usd
      FROM jobs j
      LEFT JOIN agents a ON j.agent_id = a.id
      LEFT JOIN teams t ON j.team_id = t.id
      WHERE j.one_off = 0
      AND j.id IN (SELECT job_id FROM project_jobs WHERE project_id = ?)
      ORDER BY j.name
    `).all(projectId);
  }
  return db.prepare(`
    SELECT j.*, a.name as agent_name, t.name as team_name,
      (SELECT COUNT(*) FROM runs WHERE job_id = j.id AND status NOT IN ('skipped')) as total_runs,
      (SELECT COUNT(*) FROM runs WHERE job_id = j.id AND status = 'skipped') as skipped_runs,
      (SELECT COUNT(*) FROM runs WHERE job_id = j.id AND status = 'waiting') as waiting_runs,
      (SELECT COUNT(*) FROM runs WHERE job_id = j.id AND status = 'pending') as pending_runs,
      (SELECT COALESCE(SUM(rc.estimated_cost_usd), 0) FROM run_costs rc JOIN runs r ON rc.run_id = r.id WHERE r.job_id = j.id) as total_cost_usd
    FROM jobs j
    LEFT JOIN agents a ON j.agent_id = a.id
    LEFT JOIN teams t ON j.team_id = t.id
    WHERE j.one_off = 0
    ORDER BY j.name
  `).all();
}

export function updateJob(id: string, data: {
  name?: string;
  description?: string;
  instructions?: string;
  schedule?: string;
  workflowCommand?: string;
  workflowOnly?: boolean;
  model?: string;
  thinking?: string;
  timeoutMinutes?: number;
  docIds?: string[];
  envVarIds?: string[];
  active?: boolean;
  nextRunAt?: number;
  agentId?: string | null;
  teamId?: string | null;
  preferredRole?: string | null;
  roleFallback?: string | null;
}) {
  const db = getDb();
  const fields: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const values: any[] = [];
  if (data.name !== undefined) { fields.push("name = ?"); values.push(data.name); }
  if (data.description !== undefined) { fields.push("description = ?"); values.push(data.description); }
  if (data.instructions !== undefined) { fields.push("instructions = ?"); values.push(data.instructions); }
  if (data.schedule !== undefined) { fields.push("schedule = ?"); values.push(data.schedule); }
  if (data.workflowCommand !== undefined) { fields.push("workflow_command = ?"); values.push(data.workflowCommand); }
  if (data.workflowOnly !== undefined) { fields.push("workflow_only = ?"); values.push(data.workflowOnly ? 1 : 0); }
  if (data.model !== undefined) { fields.push("model = ?"); values.push(data.model || null); }
  if (data.thinking !== undefined) { fields.push("thinking = ?"); values.push(data.thinking || null); }
  if (data.timeoutMinutes !== undefined) { fields.push("timeout_minutes = ?"); values.push(data.timeoutMinutes); }
  if (data.agentId !== undefined) { fields.push("agent_id = ?"); values.push(data.agentId); }
  if (data.teamId !== undefined) { fields.push("team_id = ?"); values.push(data.teamId); }
  if (data.preferredRole !== undefined) { fields.push("preferred_role = ?"); values.push(data.preferredRole); }
  if (data.roleFallback !== undefined) { fields.push("role_fallback = ?"); values.push(validateRoleFallback(data.roleFallback)); }

  if (data.active !== undefined) {
    fields.push("active = ?"); values.push(data.active ? 1 : 0);
    // When activating a job that has no next_run_at, compute it from the schedule
    if (data.active && data.nextRunAt === undefined) {
      const job = db.prepare(`SELECT schedule, next_run_at FROM jobs WHERE id = ?`).get(id) as any;
      if (job && !job.next_run_at && job.schedule) {
        const schedule = data.schedule || job.schedule;
        const nextRunAt = getNextRunTime(schedule, undefined, getTimezone());
        if (nextRunAt !== null) {
          fields.push("next_run_at = ?"); values.push(nextRunAt);
        }
      }
    }
  }
  if (data.nextRunAt !== undefined) { fields.push("next_run_at = ?"); values.push(data.nextRunAt); }

  const update = db.transaction(() => {
    if (fields.length > 0) {
      fields.push("updated_at = unixepoch()");
      db.prepare(`UPDATE jobs SET ${fields.join(", ")} WHERE id = ?`).run(...values, id);
    }
    if (data.docIds !== undefined) {
      db.prepare(`DELETE FROM job_docs WHERE job_id = ?`).run(id);
      const linkStmt = db.prepare(`INSERT OR IGNORE INTO job_docs (job_id, doc_id) VALUES (?, ?)`);
      for (const docId of data.docIds) linkStmt.run(id, docId);
    }
    if (data.envVarIds !== undefined) {
      db.prepare(`DELETE FROM job_env_vars WHERE job_id = ?`).run(id);
      const linkStmt = db.prepare(`INSERT OR IGNORE INTO job_env_vars (job_id, env_var_id) VALUES (?, ?)`);
      for (const envId of data.envVarIds) linkStmt.run(id, envId);
    }
  });
  update();
  return getJobById(id);
}

export function deleteJob(id: string) {
  const db = getDb();
  const runIds = db.prepare(`SELECT id FROM runs WHERE job_id = ?`).all(id) as { id: string }[];
  db.prepare(`DELETE FROM jobs WHERE id = ?`).run(id);
  for (const r of runIds) deleteRunAttachmentsDir(r.id);
}

export function createOneOffRun(agentId: string, data: {
  name: string;
  instructions?: string;
  docIds?: string[];
  envVarIds?: string[];
  runAt?: number;
}) {
  const db = getDb();
  const jobId = uuid();
  const runId = uuid();
  const now = Math.floor(Date.now() / 1000);
  const runAt = data.runAt || now;

  const create = db.transaction(() => {
    // Create the backing job (hidden, one_off)
    db.prepare(`
      INSERT INTO jobs (id, agent_id, name, instructions, schedule, one_off, active, next_run_at)
      VALUES (?, ?, ?, ?, '{}', 1, 1, ?)
    `).run(jobId, agentId, data.name, data.instructions || null, runAt);

    // Merge explicitly selected docs with pinned docs
    const allDocIds = new Set([...(data.docIds || []), ...listPinnedDocIds()]);
    if (allDocIds.size > 0) {
      const linkStmt = db.prepare(`INSERT OR IGNORE INTO job_docs (job_id, doc_id) VALUES (?, ?)`);
      for (const docId of allDocIds) linkStmt.run(jobId, docId);
    }

    // Merge explicitly selected env vars with pinned env vars
    const allEnvVarIds = new Set([...(data.envVarIds || []), ...listPinnedEnvVarIds()]);
    if (allEnvVarIds.size > 0) {
      const linkStmt = db.prepare(`INSERT OR IGNORE INTO job_env_vars (job_id, env_var_id) VALUES (?, ?)`);
      for (const envId of allEnvVarIds) linkStmt.run(jobId, envId);
    }

    // Create the run immediately with 'scheduled' status
    db.prepare(`
      INSERT INTO runs (id, job_id, agent_id, status, scheduled_for, created_at, updated_at)
      VALUES (?, ?, ?, 'scheduled', ?, ?, ?)
    `).run(runId, jobId, agentId, runAt, now, now);
  });

  create();
  return { jobId, runId };
}

export function triggerJobRun(jobId: string, extraInstructions?: string) {
  const db = getDb();
  const job = db.prepare(`SELECT id, agent_id FROM jobs WHERE id = ?`).get(jobId) as any;
  if (!job) return null;

  const runId = uuid();
  const now = Math.floor(Date.now() / 1000);

  db.prepare(`
    INSERT INTO runs (id, job_id, agent_id, status, scheduled_for, extra_instructions, created_at, updated_at)
    VALUES (?, ?, ?, 'scheduled', ?, ?, ?, ?)
  `).run(runId, jobId, job.agent_id || null, now, extraInstructions || null, now, now);

  if (extraInstructions) {
    db.prepare(`
      INSERT INTO run_activity (id, run_id, author_type, author_name, content, created_at)
      VALUES (?, ?, 'system', 'System', ?, ?)
    `).run(uuid(), runId, `Additional instructions:\n${extraInstructions}`, now);
  }

  return { jobId, runId };
}

export function linkDocToJob(jobId: string, docId: string) {
  const db = getDb();
  db.prepare(`INSERT OR IGNORE INTO job_docs (job_id, doc_id) VALUES (?, ?)`).run(jobId, docId);
}

export function unlinkDocFromJob(jobId: string, docId: string) {
  const db = getDb();
  db.prepare(`DELETE FROM job_docs WHERE job_id = ? AND doc_id = ?`).run(jobId, docId);
}

// linkDatabaseToJob and unlinkDatabaseFromJob are in database.ts

export function touchJobRan(id: string) {
  const db = getDb();
  db.prepare(`UPDATE jobs SET last_run_at = unixepoch(), updated_at = unixepoch() WHERE id = ?`).run(id);
}

// Advance a job's next_run_at based on its schedule.
// Called after a run completes (done/failed/skipped).
export function advanceJobSchedule(jobId: string) {
  const db = getDb();
  const job = db.prepare(`SELECT schedule FROM jobs WHERE id = ?`).get(jobId) as any;
  if (!job?.schedule) return;

  const nextRunAt = getNextRunTime(job.schedule, undefined, getTimezone());
  if (nextRunAt !== null) {
    db.prepare(`UPDATE jobs SET next_run_at = ?, updated_at = unixepoch() WHERE id = ?`).run(nextRunAt, jobId);
  }
}

// ---------------------------------------------------------------------------
// Async variants — cross-backend (SQLite + Postgres) via the adapter layer.
// ---------------------------------------------------------------------------

export async function createJobAsync(agentId: string | null, data: {
  name: string;
  description?: string;
  instructions?: string;
  schedule: string;
  workflowCommand?: string;
  workflowOnly?: boolean;
  model?: string;
  thinking?: string;
  docIds?: string[];
  envVarIds?: string[];
  active?: boolean;
  teamId?: string | null;
  preferredRole?: string | null;
  roleFallback?: string | null;
}) {
  const db = await getDbAsync();
  const id = uuid();
  const nextRunAt = data.active !== false ? getNextRunTime(data.schedule, undefined, await getTimezoneAsync()) : null;
  validateAssignment(agentId, data.teamId ?? null, !!data.workflowOnly);
  const roleFallback = validateRoleFallback(data.roleFallback);
  const preferredRole = data.preferredRole || null;
  const pinnedDocs = await listPinnedDocIdsAsync();
  const pinnedEnvs = await listPinnedEnvVarIdsAsync();

  await db.transaction(async (tx) => {
    await tx.run(`
      INSERT INTO jobs (id, agent_id, team_id, preferred_role, role_fallback, name, description, instructions, schedule, workflow_command, workflow_only, model, thinking, active, next_run_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, agentId, data.teamId || null, preferredRole, roleFallback,
      data.name, data.description || null,
      data.instructions || null, data.schedule,
      data.workflowCommand || null, data.workflowOnly ? 1 : 0,
      data.model || null, data.thinking || null,
      data.active !== false ? 1 : 0, nextRunAt,
    ]);
    const allDocIds = new Set([...(data.docIds || []), ...pinnedDocs]);
    for (const docId of allDocIds) {
      await tx.run(`INSERT INTO job_docs (job_id, doc_id) VALUES (?, ?) ON CONFLICT DO NOTHING`, [id, docId]);
    }
    const allEnvVarIds = new Set([...(data.envVarIds || []), ...pinnedEnvs]);
    for (const envId of allEnvVarIds) {
      await tx.run(`INSERT INTO job_env_vars (job_id, env_var_id) VALUES (?, ?) ON CONFLICT DO NOTHING`, [id, envId]);
    }
  });
  return getJobByIdAsync(id);
}

export async function getJobByIdAsync(id: string) {
  const db = await getDbAsync();
  const job = await db.get<JobRow>(`
    SELECT j.*, a.name as agent_name, t.name as team_name
    FROM jobs j
    LEFT JOIN agents a ON j.agent_id = a.id
    LEFT JOIN teams t ON j.team_id = t.id
    WHERE j.id = ?
  `, [id]);
  if (!job) return null;

  const docs = await db.all(`
    SELECT d.id, d.title FROM job_docs jd
    JOIN docs d ON jd.doc_id = d.id
    WHERE jd.job_id = ?
  `, [id]);
  const databases = await db.all(`
    SELECT d.id, d.name, d.table_name FROM job_databases jd
    JOIN databases d ON jd.database_id = d.id
    WHERE jd.job_id = ?
  `, [id]);
  const envVars = await db.all(`
    SELECT ev.id, ev.name FROM job_env_vars jev
    JOIN env_vars ev ON jev.env_var_id = ev.id
    WHERE jev.job_id = ?
  `, [id]);

  return { ...job, docs, databases, envVars };
}

export async function listJobsByAgentAsync(agentId: string) {
  const db = await getDbAsync();
  return db.all(`
    SELECT j.*,
      (SELECT COUNT(*) FROM runs WHERE job_id = j.id) as total_runs,
      (SELECT COUNT(*) FROM runs WHERE job_id = j.id AND status = 'waiting') as waiting_runs,
      (SELECT COUNT(*) FROM runs WHERE job_id = j.id AND status = 'pending') as pending_runs,
      (SELECT COUNT(*) FROM runs WHERE job_id = j.id AND status = 'skipped') as skipped_runs
    FROM jobs j WHERE j.agent_id = ? AND j.one_off = 0 ORDER BY j.name
  `, [agentId]);
}

export async function listAllJobsAsync(projectId?: string) {
  const db = await getDbAsync();
  const projectFilter = projectId
    ? `AND j.id IN (SELECT job_id FROM project_jobs WHERE project_id = ?)`
    : "";
  const args = projectId ? [projectId] : [];
  return db.all(`
    SELECT j.*, a.name as agent_name, t.name as team_name,
      (SELECT COUNT(*) FROM runs WHERE job_id = j.id AND status NOT IN ('skipped')) as total_runs,
      (SELECT COUNT(*) FROM runs WHERE job_id = j.id AND status = 'skipped') as skipped_runs,
      (SELECT COUNT(*) FROM runs WHERE job_id = j.id AND status = 'waiting') as waiting_runs,
      (SELECT COUNT(*) FROM runs WHERE job_id = j.id AND status = 'pending') as pending_runs,
      (SELECT COALESCE(SUM(rc.estimated_cost_usd), 0) FROM run_costs rc JOIN runs r ON rc.run_id = r.id WHERE r.job_id = j.id) as total_cost_usd
    FROM jobs j
    LEFT JOIN agents a ON j.agent_id = a.id
    LEFT JOIN teams t ON j.team_id = t.id
    WHERE j.one_off = 0
    ${projectFilter}
    ORDER BY j.name
  `, args);
}

export async function updateJobAsync(id: string, data: {
  name?: string;
  description?: string;
  instructions?: string;
  schedule?: string;
  workflowCommand?: string;
  workflowOnly?: boolean;
  model?: string;
  thinking?: string;
  timeoutMinutes?: number;
  docIds?: string[];
  envVarIds?: string[];
  active?: boolean;
  nextRunAt?: number;
  agentId?: string | null;
  teamId?: string | null;
  preferredRole?: string | null;
  roleFallback?: string | null;
}) {
  const db = await getDbAsync();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  if (data.name !== undefined) { fields.push("name = ?"); values.push(data.name); }
  if (data.description !== undefined) { fields.push("description = ?"); values.push(data.description); }
  if (data.instructions !== undefined) { fields.push("instructions = ?"); values.push(data.instructions); }
  if (data.schedule !== undefined) { fields.push("schedule = ?"); values.push(data.schedule); }
  if (data.workflowCommand !== undefined) { fields.push("workflow_command = ?"); values.push(data.workflowCommand); }
  if (data.workflowOnly !== undefined) { fields.push("workflow_only = ?"); values.push(data.workflowOnly ? 1 : 0); }
  if (data.model !== undefined) { fields.push("model = ?"); values.push(data.model || null); }
  if (data.thinking !== undefined) { fields.push("thinking = ?"); values.push(data.thinking || null); }
  if (data.timeoutMinutes !== undefined) { fields.push("timeout_minutes = ?"); values.push(data.timeoutMinutes); }
  if (data.agentId !== undefined) { fields.push("agent_id = ?"); values.push(data.agentId); }
  if (data.teamId !== undefined) { fields.push("team_id = ?"); values.push(data.teamId); }
  if (data.preferredRole !== undefined) { fields.push("preferred_role = ?"); values.push(data.preferredRole); }
  if (data.roleFallback !== undefined) { fields.push("role_fallback = ?"); values.push(validateRoleFallback(data.roleFallback)); }

  if (data.active !== undefined) {
    fields.push("active = ?"); values.push(data.active ? 1 : 0);
    if (data.active && data.nextRunAt === undefined) {
      const job = await db.get<{ schedule: string; next_run_at: number | null }>(
        `SELECT schedule, next_run_at FROM jobs WHERE id = ?`, [id]
      );
      if (job && !job.next_run_at && job.schedule) {
        const schedule = data.schedule || job.schedule;
        const nextRunAt = getNextRunTime(schedule, undefined, await getTimezoneAsync());
        if (nextRunAt !== null) {
          fields.push("next_run_at = ?"); values.push(nextRunAt);
        }
      }
    }
  }
  if (data.nextRunAt !== undefined) { fields.push("next_run_at = ?"); values.push(data.nextRunAt); }

  await db.transaction(async (tx) => {
    if (fields.length > 0) {
      fields.push(`updated_at = ${nowSql(tx)}`);
      await tx.run(`UPDATE jobs SET ${fields.join(", ")} WHERE id = ?`, [...values, id]);
    }
    if (data.docIds !== undefined) {
      await tx.run(`DELETE FROM job_docs WHERE job_id = ?`, [id]);
      for (const docId of data.docIds) {
        await tx.run(`INSERT INTO job_docs (job_id, doc_id) VALUES (?, ?) ON CONFLICT DO NOTHING`, [id, docId]);
      }
    }
    if (data.envVarIds !== undefined) {
      await tx.run(`DELETE FROM job_env_vars WHERE job_id = ?`, [id]);
      for (const envId of data.envVarIds) {
        await tx.run(`INSERT INTO job_env_vars (job_id, env_var_id) VALUES (?, ?) ON CONFLICT DO NOTHING`, [id, envId]);
      }
    }
  });
  return getJobByIdAsync(id);
}

export async function deleteJobAsync(id: string) {
  const db = await getDbAsync();
  const runIds = await db.all<{ id: string }>(`SELECT id FROM runs WHERE job_id = ?`, [id]);
  await db.run(`DELETE FROM jobs WHERE id = ?`, [id]);
  for (const r of runIds) deleteRunAttachmentsDir(r.id);
}

export async function createOneOffRunAsync(agentId: string, data: {
  name: string;
  instructions?: string;
  docIds?: string[];
  envVarIds?: string[];
  runAt?: number;
}) {
  const db = await getDbAsync();
  const jobId = uuid();
  const runId = uuid();
  const now = Math.floor(Date.now() / 1000);
  const runAt = data.runAt || now;
  const pinnedDocs = await listPinnedDocIdsAsync();
  const pinnedEnvs = await listPinnedEnvVarIdsAsync();

  await db.transaction(async (tx) => {
    await tx.run(`
      INSERT INTO jobs (id, agent_id, name, instructions, schedule, one_off, active, next_run_at)
      VALUES (?, ?, ?, ?, '{}', 1, 1, ?)
    `, [jobId, agentId, data.name, data.instructions || null, runAt]);

    const allDocIds = new Set([...(data.docIds || []), ...pinnedDocs]);
    for (const docId of allDocIds) {
      await tx.run(`INSERT INTO job_docs (job_id, doc_id) VALUES (?, ?) ON CONFLICT DO NOTHING`, [jobId, docId]);
    }
    const allEnvVarIds = new Set([...(data.envVarIds || []), ...pinnedEnvs]);
    for (const envId of allEnvVarIds) {
      await tx.run(`INSERT INTO job_env_vars (job_id, env_var_id) VALUES (?, ?) ON CONFLICT DO NOTHING`, [jobId, envId]);
    }
    await tx.run(`
      INSERT INTO runs (id, job_id, agent_id, status, scheduled_for, created_at, updated_at)
      VALUES (?, ?, ?, 'scheduled', ?, ?, ?)
    `, [runId, jobId, agentId, runAt, now, now]);
  });

  return { jobId, runId };
}

export async function triggerJobRunAsync(jobId: string, extraInstructions?: string) {
  const db = await getDbAsync();
  const job = await db.get<{ id: string; agent_id: string | null }>(`SELECT id, agent_id FROM jobs WHERE id = ?`, [jobId]);
  if (!job) return null;
  const runId = uuid();
  const now = Math.floor(Date.now() / 1000);
  await db.run(`
    INSERT INTO runs (id, job_id, agent_id, status, scheduled_for, extra_instructions, created_at, updated_at)
    VALUES (?, ?, ?, 'scheduled', ?, ?, ?, ?)
  `, [runId, jobId, job.agent_id || null, now, extraInstructions || null, now, now]);
  if (extraInstructions) {
    await db.run(`
      INSERT INTO run_activity (id, run_id, author_type, author_name, content, created_at)
      VALUES (?, ?, 'system', 'System', ?, ?)
    `, [uuid(), runId, `Additional instructions:\n${extraInstructions}`, now]);
  }
  return { jobId, runId };
}

export async function linkDocToJobAsync(jobId: string, docId: string) {
  const db = await getDbAsync();
  await db.run(`INSERT INTO job_docs (job_id, doc_id) VALUES (?, ?) ON CONFLICT DO NOTHING`, [jobId, docId]);
}

export async function unlinkDocFromJobAsync(jobId: string, docId: string) {
  const db = await getDbAsync();
  await db.run(`DELETE FROM job_docs WHERE job_id = ? AND doc_id = ?`, [jobId, docId]);
}

export async function touchJobRanAsync(id: string) {
  const db = await getDbAsync();
  await db.run(`UPDATE jobs SET last_run_at = ${nowSql(db)}, updated_at = ${nowSql(db)} WHERE id = ?`, [id]);
}

export async function advanceJobScheduleAsync(jobId: string) {
  const db = await getDbAsync();
  const job = await db.get<{ schedule: string | null }>(`SELECT schedule FROM jobs WHERE id = ?`, [jobId]);
  if (!job?.schedule) return;
  const nextRunAt = getNextRunTime(job.schedule, undefined, await getTimezoneAsync());
  if (nextRunAt !== null) {
    await db.run(`UPDATE jobs SET next_run_at = ?, updated_at = ${nowSql(db)} WHERE id = ?`, [nextRunAt, jobId]);
  }
}
