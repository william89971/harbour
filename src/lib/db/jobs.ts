import { getDb } from "./schema";
import { v4 as uuid } from "uuid";
import { getNextRunTime } from "../schedule";

export function createJob(agentId: string, data: {
  name: string;
  description?: string;
  instructions?: string;
  schedule: string;
  checkCommand?: string;
  model?: string;
  thinking?: string;
  active?: boolean;
}) {
  const db = getDb();
  const id = uuid();
  const nextRunAt = data.active !== false ? getNextRunTime(data.schedule) : null;
  db.prepare(`
    INSERT INTO jobs (id, agent_id, name, description, instructions, schedule, check_command, model, thinking, active, next_run_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, agentId, data.name, data.description || null,
    data.instructions || null, data.schedule,
    data.checkCommand || null, data.model || null, data.thinking || null,
    data.active !== false ? 1 : 0, nextRunAt
  );
  return getJobById(id);
}

export function getJobById(id: string) {
  const db = getDb();
  const job = db.prepare(`
    SELECT j.*, a.name as agent_name
    FROM jobs j
    JOIN agents a ON j.agent_id = a.id
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

  return { ...job, docs, databases };
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

export function listAllJobs() {
  const db = getDb();
  return db.prepare(`
    SELECT j.*, a.name as agent_name,
      (SELECT COUNT(*) FROM runs WHERE job_id = j.id AND status NOT IN ('skipped')) as total_runs,
      (SELECT COUNT(*) FROM runs WHERE job_id = j.id AND status = 'skipped') as skipped_runs,
      (SELECT COUNT(*) FROM runs WHERE job_id = j.id AND status = 'waiting') as waiting_runs,
      (SELECT COUNT(*) FROM runs WHERE job_id = j.id AND status = 'pending') as pending_runs
    FROM jobs j
    JOIN agents a ON j.agent_id = a.id
    WHERE j.one_off = 0
    ORDER BY j.name
  `).all();
}

export function updateJob(id: string, data: {
  name?: string;
  description?: string;
  instructions?: string;
  schedule?: string;
  checkCommand?: string;
  model?: string;
  thinking?: string;
  timeoutMinutes?: number;

  active?: boolean;
  nextRunAt?: number;
}) {
  const db = getDb();
  const fields: string[] = [];
  const values: any[] = [];
  if (data.name !== undefined) { fields.push("name = ?"); values.push(data.name); }
  if (data.description !== undefined) { fields.push("description = ?"); values.push(data.description); }
  if (data.instructions !== undefined) { fields.push("instructions = ?"); values.push(data.instructions); }
  if (data.schedule !== undefined) { fields.push("schedule = ?"); values.push(data.schedule); }
  if (data.checkCommand !== undefined) { fields.push("check_command = ?"); values.push(data.checkCommand); }
  if (data.model !== undefined) { fields.push("model = ?"); values.push(data.model || null); }
  if (data.thinking !== undefined) { fields.push("thinking = ?"); values.push(data.thinking || null); }
  if (data.timeoutMinutes !== undefined) { fields.push("timeout_minutes = ?"); values.push(data.timeoutMinutes); }

  if (data.active !== undefined) { fields.push("active = ?"); values.push(data.active ? 1 : 0); }
  if (data.nextRunAt !== undefined) { fields.push("next_run_at = ?"); values.push(data.nextRunAt); }
  if (fields.length === 0) return getJobById(id);
  fields.push("updated_at = unixepoch()");
  values.push(id);
  db.prepare(`UPDATE jobs SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getJobById(id);
}

export function deleteJob(id: string) {
  const db = getDb();
  db.prepare(`DELETE FROM jobs WHERE id = ?`).run(id);
}

export function createOneOffRun(agentId: string, data: {
  name: string;
  instructions?: string;
  docIds?: string[];
  runAt?: number;
}) {
  const db = getDb();
  const jobId = uuid();
  const runId = uuid();
  const now = Math.floor(Date.now() / 1000);
  const runAt = data.runAt || now;

  // Create the backing job (hidden, one_off)
  db.prepare(`
    INSERT INTO jobs (id, agent_id, name, instructions, schedule, one_off, active, next_run_at)
    VALUES (?, ?, ?, ?, '{}', 1, 1, ?)
  `).run(jobId, agentId, data.name, data.instructions || null, runAt);

  if (data.docIds?.length) {
    const linkStmt = db.prepare(`INSERT OR IGNORE INTO job_docs (job_id, doc_id) VALUES (?, ?)`);
    for (const docId of data.docIds) {
      linkStmt.run(jobId, docId);
    }
  }

  // Create the run immediately with 'scheduled' status
  db.prepare(`
    INSERT INTO runs (id, job_id, agent_id, status, scheduled_for, created_at, updated_at)
    VALUES (?, ?, ?, 'scheduled', ?, ?, ?)
  `).run(runId, jobId, agentId, runAt, now, now);

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

  const nextRunAt = getNextRunTime(job.schedule);
  if (nextRunAt !== null) {
    db.prepare(`UPDATE jobs SET next_run_at = ?, updated_at = unixepoch() WHERE id = ?`).run(nextRunAt, jobId);
  }
}
