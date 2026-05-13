import { getDb, getDbAsync } from "./schema";
import { nowSql, forUpdateSkipLocked } from "./dialect";
import type { DbAdapter } from "./adapter";
import { v4 as uuid } from "uuid";
import { getDecryptedEnvVarsForJob, getDecryptedEnvVarsForJobAsync } from "./env-vars";
import { advanceJobSchedule, advanceJobScheduleAsync } from "./jobs";
import { listAttachmentsByRun, listAttachmentsByRunAsync, deleteRunAttachmentsDir } from "./attachments";

export function createRun(jobId: string, agentId: string | null) {
  const db = getDb();
  const id = uuid();
  db.prepare(`
    INSERT INTO runs (id, job_id, agent_id, status, claimed_at)
    VALUES (?, ?, ?, 'running', unixepoch())
  `).run(id, jobId, agentId || null);
  return getRunById(id);
}

export function getRunById(id: string) {
  const db = getDb();
  const run = db.prepare(`
    SELECT r.*, j.name as job_name, j.one_off, j.workflow_only as job_workflow_only, j.agent_id, a.name as agent_name, a.type as agent_type, a.cli as agent_cli,
      rc.input_tokens as cost_input_tokens, rc.output_tokens as cost_output_tokens, rc.total_tokens as cost_total_tokens,
      rc.estimated_cost_usd as cost_estimated_usd, rc.pricing_known as cost_pricing_known, rc.provider as cost_provider, rc.model as cost_model
    FROM runs r
    JOIN jobs j ON r.job_id = j.id
    LEFT JOIN agents a ON r.agent_id = a.id
    LEFT JOIN run_costs rc ON rc.run_id = r.id
    WHERE r.id = ?
  `).get(id) as any;
  return run || null;
}

export function getRunWithActivity(id: string) {
  const run = getRunById(id);
  if (!run) return null;
  const activity = listRunActivity(id);
  return { ...run, activity };
}

export function updateRunStatus(id: string, status: string) {
  const db = getDb();
  const completedAt = (status === "done" || status === "failed" || status === "skipped" || status === "killed")
    ? ", completed_at = unixepoch()"
    : ", completed_at = NULL";
  // When a run transitions out of 'running' (to any status), clear any pending
  // kill request so it can't linger and affect a subsequent run that somehow
  // reuses the id.
  const clearKill = status !== "running" ? ", kill_requested_at = NULL" : "";
  db.prepare(`UPDATE runs SET status = ?, updated_at = unixepoch()${completedAt}${clearKill} WHERE id = ?`).run(status, id);

  // Advance the job's next_run_at when a run completes.
  // 'killed' is terminal for this run but does NOT advance the job's schedule —
  // the user stopped it intentionally and may resume it via a comment.
  if (status === "done" || status === "failed" || status === "skipped") {
    const run = getRunById(id);
    if (run?.job_id) {
      // Deactivate one-off jobs; advance schedule for recurring ones
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const job = db.prepare(`SELECT one_off FROM jobs WHERE id = ?`).get(run.job_id) as any;
      if (job?.one_off) {
        db.prepare(`UPDATE jobs SET active = 0, next_run_at = NULL, updated_at = unixepoch() WHERE id = ?`).run(run.job_id);
      } else {
        advanceJobSchedule(run.job_id);
      }
    }
  }

  // Propagate to any handoff targeting this run. pending→accepted on running;
  // accepted/pending→completed on done. We deliberately leave the handoff at
  // accepted (or pending) on failed/killed/skipped so the source operator can
  // see the work didn't finish cleanly.
  if (status === "running") {
    db.prepare(
      `UPDATE run_handoffs SET status = 'accepted', updated_at = unixepoch()
       WHERE target_run_id = ? AND status = 'pending'`,
    ).run(id);
  } else if (status === "done") {
    db.prepare(
      `UPDATE run_handoffs SET status = 'completed', updated_at = unixepoch()
       WHERE target_run_id = ? AND status IN ('pending','accepted')`,
    ).run(id);
  }

  return getRunById(id);
}

/**
 * Mark a run for kill. The runner picks this up on its next kill-check and
 * SIGTERMs the CLI child. Returns true if the kill was recorded, false if the
 * run isn't in a killable state (not running, already killed, etc).
 */
export function requestKillRun(id: string): boolean {
  const db = getDb();
  const run = getRunById(id);
  if (!run) return false;
  if (run.status !== "running") return false;
  if (run.kill_requested_at) return true; // already requested — idempotent
  db.prepare(`UPDATE runs SET kill_requested_at = unixepoch(), updated_at = unixepoch() WHERE id = ?`).run(id);
  return true;
}

export function updateRunSessionId(id: string, sessionId: string, cwd?: string) {
  const db = getDb();
  if (cwd) {
    db.prepare(`UPDATE runs SET session_id = ?, session_cwd = ?, updated_at = unixepoch() WHERE id = ?`).run(sessionId, cwd, id);
  } else {
    db.prepare(`UPDATE runs SET session_id = ?, updated_at = unixepoch() WHERE id = ?`).run(sessionId, id);
  }
}

export function isKillRequested(id: string): boolean {
  const db = getDb();
  const row = db.prepare(`SELECT kill_requested_at FROM runs WHERE id = ?`).get(id) as any;
  return !!row?.kill_requested_at;
}

export function deleteRun(id: string) {
  const db = getDb();
  db.prepare(`DELETE FROM runs WHERE id = ?`).run(id);
  deleteRunAttachmentsDir(id);
}

export function listRunsByJob(jobId: string, limit = 50) {
  const db = getDb();
  return db.prepare(`
    SELECT r.*, j.name as job_name, a.name as agent_name
    FROM runs r
    JOIN jobs j ON r.job_id = j.id
    LEFT JOIN agents a ON r.agent_id = a.id
    WHERE r.job_id = ? ORDER BY r.created_at DESC LIMIT ?
  `).all(jobId, limit);
}

export function listRunsByAgent(agentId: string, limit = 50) {
  const db = getDb();
  return db.prepare(`
    SELECT r.*, j.name as job_name, a.name as agent_name
    FROM runs r
    JOIN jobs j ON r.job_id = j.id
    LEFT JOIN agents a ON r.agent_id = a.id
    WHERE r.agent_id = ? ORDER BY r.created_at DESC LIMIT ?
  `).all(agentId, limit);
}

export function listScheduledRuns(projectId?: string) {
  const db = getDb();
  const projectFilter = projectId ? `AND r.job_id IN (SELECT job_id FROM project_jobs WHERE project_id = ?)` : "";
  return db.prepare(`
    SELECT r.*, j.name as job_name, j.active as job_active, j.workflow_command as job_workflow_command, j.workflow_only as job_workflow_only, a.name as agent_name
    FROM runs r
    JOIN jobs j ON r.job_id = j.id
    LEFT JOIN agents a ON r.agent_id = a.id
    WHERE r.status = 'scheduled' ${projectFilter}
    ORDER BY r.scheduled_for ASC
  `).all(...(projectId ? [projectId] : []));
}

export function listRunningRuns(projectId?: string) {
  const db = getDb();
  const projectFilter = projectId ? `AND r.job_id IN (SELECT job_id FROM project_jobs WHERE project_id = ?)` : "";
  return db.prepare(`
    SELECT r.*, j.name as job_name, j.active as job_active, j.workflow_command as job_workflow_command, j.workflow_only as job_workflow_only, a.name as agent_name
    FROM runs r
    JOIN jobs j ON r.job_id = j.id
    LEFT JOIN agents a ON r.agent_id = a.id
    WHERE r.status = 'running' ${projectFilter}
    ORDER BY r.updated_at DESC
  `).all(...(projectId ? [projectId] : []));
}

export function listWaitingRuns(projectId?: string) {
  const db = getDb();
  const projectFilter = projectId ? `AND r.job_id IN (SELECT job_id FROM project_jobs WHERE project_id = ?)` : "";
  return db.prepare(`
    SELECT r.*, j.name as job_name, j.active as job_active, j.workflow_command as job_workflow_command, j.workflow_only as job_workflow_only, a.name as agent_name
    FROM runs r
    JOIN jobs j ON r.job_id = j.id
    LEFT JOIN agents a ON r.agent_id = a.id
    WHERE r.status IN ('waiting', 'pending') ${projectFilter}
    ORDER BY r.updated_at ASC
  `).all(...(projectId ? [projectId] : []));
}

export function listRecentRuns(limit = 10, projectId?: string) {
  const db = getDb();
  const projectFilter = projectId ? `AND r.job_id IN (SELECT job_id FROM project_jobs WHERE project_id = ?)` : "";
  return db.prepare(`
    SELECT r.*, j.name as job_name, j.active as job_active, j.workflow_command as job_workflow_command, j.workflow_only as job_workflow_only, a.name as agent_name
    FROM runs r
    JOIN jobs j ON r.job_id = j.id
    LEFT JOIN agents a ON r.agent_id = a.id
    WHERE r.status IN ('done', 'failed') ${projectFilter}
    ORDER BY r.completed_at DESC LIMIT ?
  `).all(...(projectId ? [projectId, limit] : [limit]));
}

// Activity log

export function addRunActivity(runId: string, authorType: string, authorId: string | null, authorName: string, content: string) {
  const db = getDb();
  const id = uuid();
  db.prepare(`
    INSERT INTO run_activity (id, run_id, author_type, author_id, author_name, content)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, runId, authorType, authorId, authorName, content);
  db.prepare(`UPDATE runs SET updated_at = unixepoch() WHERE id = ?`).run(runId);
  return { id, run_id: runId, author_type: authorType, author_id: authorId, author_name: authorName, content, created_at: Math.floor(Date.now() / 1000) };
}

export function listRunActivity(runId: string) {
  const db = getDb();
  return db.prepare(`SELECT * FROM run_activity WHERE run_id = ? ORDER BY created_at ASC`).all(runId);
}

// Run output (streaming events from CLI agents)

export type RunOutputEvent = {
  id?: number;
  run_id: string;
  event_type: string;
  content: string | null;
  tool_name: string | null;
  created_at?: number;
};

export function addRunOutput(runId: string, events: Omit<RunOutputEvent, "run_id" | "id" | "created_at">[]) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO run_output (run_id, event_type, content, tool_name)
    VALUES (?, ?, ?, ?)
  `);
  const insertMany = db.transaction((evts: typeof events) => {
    for (const e of evts) {
      stmt.run(runId, e.event_type, e.content || null, e.tool_name || null);
    }
  });
  insertMany(events);
  db.prepare(`UPDATE runs SET updated_at = unixepoch() WHERE id = ?`).run(runId);
}

export function listRunOutput(runId: string, afterId = 0) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM run_output WHERE run_id = ? AND id > ? ORDER BY id ASC
  `).all(runId, afterId) as RunOutputEvent[];
}

// Fail runs that have exceeded their job's timeout
function failStaleRuns(agentId: string) {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const stale = db.prepare(`
    SELECT r.id, j.timeout_minutes FROM runs r
    JOIN jobs j ON r.job_id = j.id
    WHERE r.agent_id = ? AND r.status = 'running'
    AND r.updated_at + (j.timeout_minutes * 60) < ?
  `).all(agentId, now) as { id: string; timeout_minutes: number }[];

  for (const run of stale) {
    db.prepare(`UPDATE runs SET status = 'failed', completed_at = unixepoch(), updated_at = unixepoch() WHERE id = ?`).run(run.id);
    const actId = uuid();
    db.prepare(`
      INSERT INTO run_activity (id, run_id, author_type, author_name, content, created_at)
      VALUES (?, ?, 'system', 'System', ?, unixepoch())
    `).run(actId, run.id, `Run timed out after ${run.timeout_minutes} minutes without completion.`);

    // Deactivate one-off jobs
    const job = db.prepare(`SELECT one_off FROM jobs WHERE id = (SELECT job_id FROM runs WHERE id = ?)`).get(run.id) as any;
    if (job?.one_off) {
      db.prepare(`UPDATE jobs SET active = 0, next_run_at = NULL, updated_at = unixepoch() WHERE id = (SELECT job_id FROM runs WHERE id = ?)`).run(run.id);
    }
  }

  return stale.length;
}

// Agent polling: get next run

export function getAgentNextRun(agentId: string) {
  const db = getDb();

  // 0. Fail any stale running runs that exceeded their timeout
  failStaleRuns(agentId);

  // Capacity gate: skip transaction work if agent is already at its concurrent limit.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agentRow = db.prepare(`SELECT max_concurrent_runs FROM agents WHERE id = ?`).get(agentId) as any;
  const maxConcurrent = Math.max(1, Math.min(10, Number(agentRow?.max_concurrent_runs) || 1));

  // Wrap in a transaction so run assignment is atomic
  const assignRun = db.transaction(() => {
    // 1. Capacity check — count active running runs for this agent
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const countRow = db.prepare(`SELECT COUNT(*) as c FROM runs WHERE agent_id = ? AND status = 'running'`).get(agentId) as any;
    if ((countRow?.c ?? 0) >= maxConcurrent) return null;

    // 2. Pending run? (human responded, ready for agent to resume)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pendingRun = db.prepare(`
      SELECT id FROM runs
      WHERE agent_id = ? AND status = 'pending'
      ORDER BY updated_at ASC LIMIT 1
    `).get(agentId) as any;

    if (pendingRun) {
      db.prepare(`UPDATE runs SET status = 'running', updated_at = unixepoch() WHERE id = ?`).run(pendingRun.id);
      return pendingRun.id as string;
    }

    const now = Math.floor(Date.now() / 1000);

    // 3. Scheduled run ready to start? (one-off runs created via dashboard)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scheduledRun = db.prepare(`
      SELECT id FROM runs
      WHERE agent_id = ? AND status = 'scheduled' AND scheduled_for <= ?
      ORDER BY scheduled_for ASC LIMIT 1
    `).get(agentId, now) as any;

    if (scheduledRun) {
      db.prepare(`UPDATE runs SET status = 'running', claimed_at = unixepoch(), updated_at = unixepoch() WHERE id = ?`).run(scheduledRun.id);
      db.prepare(`UPDATE jobs SET last_run_at = unixepoch(), updated_at = unixepoch() WHERE id = (SELECT job_id FROM runs WHERE id = ?)`).run(scheduledRun.id);
      return scheduledRun.id as string;
    }

    // 3b. Team-handoff scheduled run: agent_id IS NULL, job has team_id, and
    // this agent is a member with a role-eligible match. Adopting sets agent_id.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const teamHandoffRun = db.prepare(`
      SELECT r.id FROM runs r
      JOIN jobs j ON r.job_id = j.id
      JOIN team_agents ta ON ta.team_id = j.team_id AND ta.agent_id = ?
      WHERE r.agent_id IS NULL AND r.status = 'scheduled' AND r.scheduled_for <= ?
        AND j.team_id IS NOT NULL
        AND (
          j.preferred_role IS NULL
          OR ta.role = j.preferred_role
          OR (
            j.role_fallback = 'any'
            AND NOT EXISTS (
              SELECT 1 FROM team_agents tam
              JOIN agents am ON am.id = tam.agent_id
              WHERE tam.team_id = j.team_id AND tam.role = j.preferred_role
                AND (SELECT COUNT(*) FROM runs WHERE agent_id = am.id AND status = 'running') < am.max_concurrent_runs
            )
          )
        )
      ORDER BY (CASE WHEN ta.role = j.preferred_role THEN 0 ELSE 1 END), r.scheduled_for ASC
      LIMIT 1
    `).get(agentId, now) as any;

    if (teamHandoffRun) {
      db.prepare(`UPDATE runs SET agent_id = ?, status = 'running', claimed_at = unixepoch(), updated_at = unixepoch() WHERE id = ?`).run(agentId, teamHandoffRun.id);
      db.prepare(`UPDATE jobs SET last_run_at = unixepoch(), updated_at = unixepoch() WHERE id = (SELECT job_id FROM runs WHERE id = ?)`).run(teamHandoffRun.id);
      return teamHandoffRun.id as string;
    }

    // 4. Any recurring DIRECT-ASSIGNED job past its schedule time without an active run?
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const readyJob = db.prepare(`
      SELECT j.id, j.agent_id FROM jobs j
      WHERE j.agent_id = ? AND j.team_id IS NULL AND j.active = 1 AND j.one_off = 0
      AND j.next_run_at IS NOT NULL AND j.next_run_at <= ?
      AND NOT EXISTS (
        SELECT 1 FROM runs WHERE job_id = j.id AND status IN ('scheduled', 'running', 'waiting', 'pending')
      )
      ORDER BY j.next_run_at ASC LIMIT 1
    `).get(agentId, now) as any;

    if (readyJob) {
      const run = createRun(readyJob.id, agentId);
      db.prepare(`UPDATE jobs SET last_run_at = unixepoch(), updated_at = unixepoch() WHERE id = ?`).run(readyJob.id);
      // Advance next_run_at immediately so the job doesn't re-fire on the next poll
      advanceJobSchedule(readyJob.id);
      return run!.id as string;
    }

    // 5. Team-assigned recurring job the agent is eligible for, with role preference.
    // Role priority: if preferred_role matches our role in the team, claim. Otherwise
    // fall back per job.role_fallback: 'any' lets non-matching members claim only if
    // every role-matching teammate is at capacity; 'wait' restricts to matching role.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const teamJob = db.prepare(`
      SELECT j.id, j.preferred_role, j.role_fallback, ta.role AS my_role
      FROM jobs j
      JOIN team_agents ta ON ta.team_id = j.team_id AND ta.agent_id = ?
      WHERE j.team_id IS NOT NULL AND j.active = 1 AND j.one_off = 0
        AND j.next_run_at IS NOT NULL AND j.next_run_at <= ?
        AND NOT EXISTS (
          SELECT 1 FROM runs WHERE job_id = j.id AND status IN ('scheduled','running','waiting','pending')
        )
        AND (
          j.preferred_role IS NULL
          OR ta.role = j.preferred_role
          OR (
            j.role_fallback = 'any'
            AND NOT EXISTS (
              SELECT 1 FROM team_agents tam
              JOIN agents am ON am.id = tam.agent_id
              WHERE tam.team_id = j.team_id AND tam.role = j.preferred_role
                AND (SELECT COUNT(*) FROM runs WHERE agent_id = am.id AND status = 'running') < am.max_concurrent_runs
            )
          )
        )
      ORDER BY (CASE WHEN ta.role = j.preferred_role THEN 0 ELSE 1 END), j.next_run_at ASC
      LIMIT 1
    `).get(agentId, now) as any;

    if (teamJob) {
      const run = createRun(teamJob.id, agentId);
      db.prepare(`UPDATE jobs SET last_run_at = unixepoch(), updated_at = unixepoch() WHERE id = ?`).run(teamJob.id);
      advanceJobSchedule(teamJob.id);
      return run!.id as string;
    }

    return null;
  });

  const runId = assignRun();
  if (!runId) return null;
  return buildRunPayload(runId);
}

// Workflow polling: get next agentless workflow-only run
export function getNextWorkflowRun() {
  const db = getDb();

  // Fail stale agentless workflow runs
  const now = Math.floor(Date.now() / 1000);
  const stale = db.prepare(`
    SELECT r.id, j.timeout_minutes FROM runs r
    JOIN jobs j ON r.job_id = j.id
    WHERE r.agent_id IS NULL AND r.status = 'running'
    AND r.updated_at + (j.timeout_minutes * 60) < ?
  `).all(now) as { id: string; timeout_minutes: number }[];
  for (const run of stale) {
    db.prepare(`UPDATE runs SET status = 'failed', completed_at = unixepoch(), updated_at = unixepoch() WHERE id = ?`).run(run.id);
    db.prepare(`
      INSERT INTO run_activity (id, run_id, author_type, author_name, content, created_at)
      VALUES (?, ?, 'system', 'System', ?, unixepoch())
    `).run(uuid(), run.id, `Run timed out after ${run.timeout_minutes} minutes without completion.`);
  }

  const assignRun = db.transaction(() => {
    // Scheduled run ready to start?
    const scheduledRun = db.prepare(`
      SELECT id FROM runs
      WHERE agent_id IS NULL AND status = 'scheduled' AND scheduled_for <= ?
      ORDER BY scheduled_for ASC LIMIT 1
    `).get(now) as any;

    if (scheduledRun) {
      db.prepare(`UPDATE runs SET status = 'running', claimed_at = unixepoch(), updated_at = unixepoch() WHERE id = ?`).run(scheduledRun.id);
      db.prepare(`UPDATE jobs SET last_run_at = unixepoch(), updated_at = unixepoch() WHERE id = (SELECT job_id FROM runs WHERE id = ?)`).run(scheduledRun.id);
      return scheduledRun.id as string;
    }

    // Any recurring agentless workflow job past its schedule time?
    const readyJob = db.prepare(`
      SELECT j.id FROM jobs j
      WHERE j.agent_id IS NULL AND j.active = 1 AND j.one_off = 0
      AND j.workflow_only = 1 AND j.workflow_command IS NOT NULL
      AND j.next_run_at IS NOT NULL AND j.next_run_at <= ?
      AND NOT EXISTS (
        SELECT 1 FROM runs WHERE job_id = j.id AND status IN ('scheduled', 'running', 'waiting', 'pending')
      )
      ORDER BY j.next_run_at ASC LIMIT 1
    `).get(now) as any;

    if (readyJob) {
      const run = createRun(readyJob.id, null);
      db.prepare(`UPDATE jobs SET last_run_at = unixepoch(), updated_at = unixepoch() WHERE id = ?`).run(readyJob.id);
      advanceJobSchedule(readyJob.id);
      return run!.id as string;
    }

    return null;
  });

  const runId = assignRun();
  if (!runId) return null;
  return buildRunPayload(runId);
}

export function peekAgentNext(agentId: string) {
  const db = getDb();

  // Fail stale runs so peek accurately reflects availability
  failStaleRuns(agentId);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agentRow = db.prepare(`SELECT max_concurrent_runs FROM agents WHERE id = ?`).get(agentId) as any;
  const maxConcurrent = Math.max(1, Math.min(10, Number(agentRow?.max_concurrent_runs) || 1));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runningCount = db.prepare(`SELECT COUNT(*) as c FROM runs WHERE agent_id = ? AND status = 'running'`).get(agentId) as any;
  if ((runningCount?.c ?? 0) >= maxConcurrent) return { available: false, reason: "busy" };

  const pendingRun = db.prepare(`
    SELECT r.id, j.name as job_name FROM runs r
    JOIN jobs j ON r.job_id = j.id
    WHERE r.agent_id = ? AND r.status = 'pending'
    ORDER BY r.updated_at ASC LIMIT 1
  `).get(agentId) as any;

  if (pendingRun) {
    return { available: true, type: "pending_resume", run_id: pendingRun.id, job_name: pendingRun.job_name };
  }

  const now = Math.floor(Date.now() / 1000);

  const scheduledRun = db.prepare(`
    SELECT r.id, j.name as job_name FROM runs r
    JOIN jobs j ON r.job_id = j.id
    WHERE r.agent_id = ? AND r.status = 'scheduled' AND r.scheduled_for <= ?
    ORDER BY r.scheduled_for ASC LIMIT 1
  `).get(agentId, now) as any;

  if (scheduledRun) {
    return { available: true, type: "scheduled_run", run_id: scheduledRun.id, job_name: scheduledRun.job_name };
  }

  const readyJob = db.prepare(`
    SELECT j.id, j.name FROM jobs j
    WHERE j.agent_id = ? AND j.active = 1 AND j.one_off = 0
    AND j.next_run_at IS NOT NULL AND j.next_run_at <= ?
    AND NOT EXISTS (SELECT 1 FROM runs WHERE job_id = j.id AND status IN ('scheduled', 'running', 'waiting', 'pending'))
    ORDER BY j.next_run_at ASC LIMIT 1
  `).get(agentId, now) as any;

  if (readyJob) {
    return { available: true, type: "scheduled", job_id: readyJob.id, job_name: readyJob.name };
  }

  return { available: false, reason: "nothing_to_do" };
}

function buildRunPayload(runId: string) {
  const db = getDb();
  const run = getRunWithActivity(runId);
  if (!run) return null;

  const job = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(run.job_id) as any;

  // Get referenced docs
  const docs = db.prepare(`
    SELECT d.id, d.title, dr.content
    FROM job_docs jd
    JOIN docs d ON jd.doc_id = d.id
    LEFT JOIN doc_revisions dr ON dr.doc_id = d.id
    AND dr.created_at = (SELECT MAX(created_at) FROM doc_revisions WHERE doc_id = d.id)
    WHERE jd.job_id = ?
  `).all(run.job_id);

  // Get referenced databases (recent rows from each linked table)
  const linkedDbs = db.prepare(`
    SELECT d.name, d.table_name
    FROM job_databases jd
    JOIN databases d ON jd.database_id = d.id
    WHERE jd.job_id = ?
  `).all(run.job_id) as { name: string; table_name: string }[];

  const data: Record<string, any> = {};
  for (const d of linkedDbs) {
    data[d.name] = db.prepare(
      `SELECT * FROM "${d.table_name}" ORDER BY rowid DESC LIMIT 100`
    ).all();
  }

  // Decrypt env vars for this job
  const env = getDecryptedEnvVarsForJob(run.job_id);

  // Run attachments (raw rows; the route serializer adds absolute URLs)
  const attachments = listAttachmentsByRun(run.id);

  // Combine job instructions with any extra trigger-time instructions
  let instructions = job.instructions || null;
  if (run.extra_instructions) {
    instructions = instructions
      ? `${instructions}\n\n---\n\nAdditional instructions for this run:\n${run.extra_instructions}`
      : run.extra_instructions;
  }

  // Agent runtime config (eager, permission_mode, tool_permissions,
  // api_base_url, api_key_env) — read live so remote runners pick up
  // dashboard toggles without reconnecting.
  const agentRow = run.agent_id
    ? db.prepare(`SELECT eager, permission_mode, api_base_url, api_key_env,
        can_read_docs, can_write_docs, can_read_databases, can_write_databases,
        can_read_env_vars, can_create_runs, can_create_handoffs,
        can_post_activity, can_update_status, can_use_shell
      FROM agents WHERE id = ?`).get(run.agent_id) as Record<string, unknown> | undefined
    : undefined;
  const agent = agentRow ? {
    eager: !!agentRow.eager,
    permission_mode: agentRow.permission_mode,
    api_base_url: agentRow.api_base_url,
    api_key_env: agentRow.api_key_env,
    tool_permissions: {
      read_docs: !!agentRow.can_read_docs,
      write_docs: !!agentRow.can_write_docs,
      read_databases: !!agentRow.can_read_databases,
      write_databases: !!agentRow.can_write_databases,
      read_env_vars: !!agentRow.can_read_env_vars,
      create_runs: !!agentRow.can_create_runs,
      create_handoffs: !!agentRow.can_create_handoffs,
      post_activity: !!agentRow.can_post_activity,
      update_status: !!agentRow.can_update_status,
      use_shell: !!agentRow.can_use_shell,
    },
  } : undefined;

  return {
    run: { id: run.id, status: run.status, activity: run.activity },
    job: {
      id: job.id,
      name: job.name,
      instructions,
      workflow: job.workflow_command,
      workflow_only: !!job.workflow_only,
      model: job.model || null,
      thinking: job.thinking || null,
      timeout_minutes: job.timeout_minutes ?? 30,
    },
    ...(agent ? { agent } : {}),
    docs,
    data,
    env,
    attachments,
  };
}

// ---------------------------------------------------------------------------
// Async variants — cross-backend (SQLite + Postgres) via the adapter layer.
// The two `getNext*RunAsync` functions are the only race-sensitive paths; on
// Postgres they use FOR UPDATE SKIP LOCKED for row-level locking so concurrent
// agent polls don't serialize on a database-level write lock.
// ---------------------------------------------------------------------------

export async function createRunAsync(jobId: string, agentId: string | null) {
  const db = await getDbAsync();
  const id = uuid();
  await db.run(
    `INSERT INTO runs (id, job_id, agent_id, status, claimed_at) VALUES (?, ?, ?, 'running', ${nowSql(db)})`,
    [id, jobId, agentId || null],
  );
  return getRunByIdAsync(id);
}

/** Shared shape between sync getRunById + async getRunByIdAsync so route
 *  handlers can rely on `run.agent_id`, `run.status`, etc. being typed. */
export type RunRow = {
  id: string;
  job_id: string;
  agent_id: string | null;
  status: string;
  scheduled_for: number | null;
  claimed_at: number | null;
  completed_at: number | null;
  kill_requested_at: number | null;
  extra_instructions: string | null;
  session_id: string | null;
  session_cwd: string | null;
  created_at: number;
  updated_at: number;
  job_name: string | null;
  one_off: number;
  job_workflow_only: number;
  agent_name: string | null;
  agent_type: string | null;
  agent_cli: string | null;
};

export async function getRunByIdAsync(id: string): Promise<RunRow | null> {
  const db = await getDbAsync();
  return db.get<RunRow>(`
    SELECT r.*, j.name as job_name, j.one_off, j.workflow_only as job_workflow_only, j.agent_id, a.name as agent_name, a.type as agent_type, a.cli as agent_cli,
      rc.input_tokens as cost_input_tokens, rc.output_tokens as cost_output_tokens, rc.total_tokens as cost_total_tokens,
      rc.estimated_cost_usd as cost_estimated_usd, rc.pricing_known as cost_pricing_known, rc.provider as cost_provider, rc.model as cost_model
    FROM runs r
    JOIN jobs j ON r.job_id = j.id
    LEFT JOIN agents a ON r.agent_id = a.id
    LEFT JOIN run_costs rc ON rc.run_id = r.id
    WHERE r.id = ?
  `, [id]);
}

export async function getRunWithActivityAsync(id: string) {
  const run = await getRunByIdAsync(id);
  if (!run) return null;
  const activity = await listRunActivityAsync(id);
  return { ...run, activity };
}

export async function updateRunStatusAsync(id: string, status: string) {
  const db = await getDbAsync();
  const terminal = status === "done" || status === "failed" || status === "skipped" || status === "killed";
  const completedAt = terminal ? `, completed_at = ${nowSql(db)}` : `, completed_at = NULL`;
  const clearKill = status !== "running" ? `, kill_requested_at = NULL` : "";
  await db.run(
    `UPDATE runs SET status = ?, updated_at = ${nowSql(db)}${completedAt}${clearKill} WHERE id = ?`,
    [status, id],
  );

  if (status === "done" || status === "failed" || status === "skipped") {
    const run = await getRunByIdAsync(id);
    const jobId = (run as { job_id?: string } | null)?.job_id;
    if (jobId) {
      const job = await db.get<{ one_off: number }>(`SELECT one_off FROM jobs WHERE id = ?`, [jobId]);
      if (job?.one_off) {
        await db.run(`UPDATE jobs SET active = 0, next_run_at = NULL, updated_at = ${nowSql(db)} WHERE id = ?`, [jobId]);
      } else {
        await advanceJobScheduleAsync(jobId);
      }
    }
  }

  // Propagate handoff status — matches the sync version.
  if (status === "running") {
    await db.run(
      `UPDATE run_handoffs SET status = 'accepted', updated_at = ${nowSql(db)}
       WHERE target_run_id = ? AND status = 'pending'`,
      [id],
    );
  } else if (status === "done") {
    await db.run(
      `UPDATE run_handoffs SET status = 'completed', updated_at = ${nowSql(db)}
       WHERE target_run_id = ? AND status IN ('pending','accepted')`,
      [id],
    );
  }

  // Propagate workflow step advancement. If this run belongs to a
  // workflow_step_run in status='running', either advance to the next
  // step or pause for after-step approval.
  if (terminal) {
    try {
      const { advanceWorkflowAfterRunAsync } = await import("./workflows");
      await advanceWorkflowAfterRunAsync(id, status);
    } catch (err) {
      // Non-fatal: workflow advancement failure shouldn't roll back the
      // primary status write. The workflow_run row will reflect the
      // stuck state and an operator can intervene from the UI.
      console.error("[runs] workflow advancement failed:", err);
    }
  }

  return getRunByIdAsync(id);
}

export async function requestKillRunAsync(id: string): Promise<boolean> {
  const db = await getDbAsync();
  const run = await getRunByIdAsync(id) as { status?: string; kill_requested_at?: number | null } | null;
  if (!run) return false;
  if (run.status !== "running") return false;
  if (run.kill_requested_at) return true;
  await db.run(`UPDATE runs SET kill_requested_at = ${nowSql(db)}, updated_at = ${nowSql(db)} WHERE id = ?`, [id]);
  return true;
}

export async function updateRunSessionIdAsync(id: string, sessionId: string, cwd?: string) {
  const db = await getDbAsync();
  if (cwd) {
    await db.run(`UPDATE runs SET session_id = ?, session_cwd = ?, updated_at = ${nowSql(db)} WHERE id = ?`, [sessionId, cwd, id]);
  } else {
    await db.run(`UPDATE runs SET session_id = ?, updated_at = ${nowSql(db)} WHERE id = ?`, [sessionId, id]);
  }
}

export async function isKillRequestedAsync(id: string): Promise<boolean> {
  const db = await getDbAsync();
  const row = await db.get<{ kill_requested_at: number | null }>(`SELECT kill_requested_at FROM runs WHERE id = ?`, [id]);
  return !!row?.kill_requested_at;
}

export async function deleteRunAsync(id: string) {
  const db = await getDbAsync();
  await db.run(`DELETE FROM runs WHERE id = ?`, [id]);
  deleteRunAttachmentsDir(id);
}

export async function listRunsByJobAsync(jobId: string, limit = 50) {
  const db = await getDbAsync();
  return db.all(`
    SELECT r.*, j.name as job_name, a.name as agent_name
    FROM runs r
    JOIN jobs j ON r.job_id = j.id
    LEFT JOIN agents a ON r.agent_id = a.id
    WHERE r.job_id = ? ORDER BY r.created_at DESC LIMIT ?
  `, [jobId, limit]);
}

export async function listRunsByAgentAsync(agentId: string, limit = 50) {
  const db = await getDbAsync();
  return db.all(`
    SELECT r.*, j.name as job_name, a.name as agent_name
    FROM runs r
    JOIN jobs j ON r.job_id = j.id
    LEFT JOIN agents a ON r.agent_id = a.id
    WHERE r.agent_id = ? ORDER BY r.created_at DESC LIMIT ?
  `, [agentId, limit]);
}

export async function listScheduledRunsAsync(projectId?: string) {
  const db = await getDbAsync();
  const projectFilter = projectId ? `AND r.job_id IN (SELECT job_id FROM project_jobs WHERE project_id = ?)` : "";
  return db.all(`
    SELECT r.*, j.name as job_name, j.active as job_active, j.workflow_command as job_workflow_command, j.workflow_only as job_workflow_only, a.name as agent_name
    FROM runs r
    JOIN jobs j ON r.job_id = j.id
    LEFT JOIN agents a ON r.agent_id = a.id
    WHERE r.status = 'scheduled' ${projectFilter}
    ORDER BY r.scheduled_for ASC
  `, projectId ? [projectId] : []);
}

export async function listRunningRunsAsync(projectId?: string) {
  const db = await getDbAsync();
  const projectFilter = projectId ? `AND r.job_id IN (SELECT job_id FROM project_jobs WHERE project_id = ?)` : "";
  return db.all(`
    SELECT r.*, j.name as job_name, j.active as job_active, j.workflow_command as job_workflow_command, j.workflow_only as job_workflow_only, a.name as agent_name
    FROM runs r
    JOIN jobs j ON r.job_id = j.id
    LEFT JOIN agents a ON r.agent_id = a.id
    WHERE r.status = 'running' ${projectFilter}
    ORDER BY r.updated_at DESC
  `, projectId ? [projectId] : []);
}

export async function listWaitingRunsAsync(projectId?: string) {
  const db = await getDbAsync();
  const projectFilter = projectId ? `AND r.job_id IN (SELECT job_id FROM project_jobs WHERE project_id = ?)` : "";
  return db.all(`
    SELECT r.*, j.name as job_name, j.active as job_active, j.workflow_command as job_workflow_command, j.workflow_only as job_workflow_only, a.name as agent_name
    FROM runs r
    JOIN jobs j ON r.job_id = j.id
    LEFT JOIN agents a ON r.agent_id = a.id
    WHERE r.status IN ('waiting', 'pending') ${projectFilter}
    ORDER BY r.updated_at ASC
  `, projectId ? [projectId] : []);
}

export async function listRecentRunsAsync(limit = 10, projectId?: string) {
  const db = await getDbAsync();
  const projectFilter = projectId ? `AND r.job_id IN (SELECT job_id FROM project_jobs WHERE project_id = ?)` : "";
  return db.all(`
    SELECT r.*, j.name as job_name, j.active as job_active, j.workflow_command as job_workflow_command, j.workflow_only as job_workflow_only, a.name as agent_name
    FROM runs r
    JOIN jobs j ON r.job_id = j.id
    LEFT JOIN agents a ON r.agent_id = a.id
    WHERE r.status IN ('done', 'failed') ${projectFilter}
    ORDER BY r.completed_at DESC LIMIT ?
  `, projectId ? [projectId, limit] : [limit]);
}

export async function addRunActivityAsync(runId: string, authorType: string, authorId: string | null, authorName: string, content: string) {
  const db = await getDbAsync();
  const id = uuid();
  await db.run(
    `INSERT INTO run_activity (id, run_id, author_type, author_id, author_name, content) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, runId, authorType, authorId, authorName, content],
  );
  await db.run(`UPDATE runs SET updated_at = ${nowSql(db)} WHERE id = ?`, [runId]);
  return { id, run_id: runId, author_type: authorType, author_id: authorId, author_name: authorName, content, created_at: Math.floor(Date.now() / 1000) };
}

export async function listRunActivityAsync(runId: string) {
  const db = await getDbAsync();
  return db.all(`SELECT * FROM run_activity WHERE run_id = ? ORDER BY created_at ASC`, [runId]);
}

export async function addRunOutputAsync(runId: string, events: Omit<RunOutputEvent, "run_id" | "id" | "created_at">[]) {
  if (events.length === 0) return;
  const db = await getDbAsync();
  await db.transaction(async (tx) => {
    for (const e of events) {
      await tx.run(
        `INSERT INTO run_output (run_id, event_type, content, tool_name) VALUES (?, ?, ?, ?)`,
        [runId, e.event_type, e.content || null, e.tool_name || null],
      );
    }
    await tx.run(`UPDATE runs SET updated_at = ${nowSql(tx)} WHERE id = ?`, [runId]);
  });
}

export async function listRunOutputAsync(runId: string, afterId = 0): Promise<RunOutputEvent[]> {
  const db = await getDbAsync();
  return db.all<RunOutputEvent>(
    `SELECT * FROM run_output WHERE run_id = ? AND id > ? ORDER BY id ASC`,
    [runId, afterId],
  );
}

async function failStaleRunsAsync(db: DbAdapter, agentId: string): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const stale = await db.all<{ id: string; timeout_minutes: number }>(
    `SELECT r.id, j.timeout_minutes FROM runs r
     JOIN jobs j ON r.job_id = j.id
     WHERE r.agent_id = ? AND r.status = 'running'
     AND r.updated_at + (j.timeout_minutes * 60) < ?`,
    [agentId, now],
  );
  for (const run of stale) {
    await db.run(
      `UPDATE runs SET status = 'failed', completed_at = ${nowSql(db)}, updated_at = ${nowSql(db)} WHERE id = ?`,
      [run.id],
    );
    await db.run(
      `INSERT INTO run_activity (id, run_id, author_type, author_name, content, created_at)
       VALUES (?, ?, 'system', 'System', ?, ${nowSql(db)})`,
      [uuid(), run.id, `Run timed out after ${run.timeout_minutes} minutes without completion.`],
    );
    const job = await db.get<{ one_off: number }>(
      `SELECT one_off FROM jobs WHERE id = (SELECT job_id FROM runs WHERE id = ?)`,
      [run.id],
    );
    if (job?.one_off) {
      await db.run(
        `UPDATE jobs SET active = 0, next_run_at = NULL, updated_at = ${nowSql(db)}
         WHERE id = (SELECT job_id FROM runs WHERE id = ?)`,
        [run.id],
      );
    }
  }
  return stale.length;
}

/** Atomic agent run claim. Honors max_concurrent_runs (capacity gate) and
 *  team assignment with role-priority + fallback. SQLite serializes on the
 *  transaction's write lock; Postgres uses FOR UPDATE SKIP LOCKED on candidate
 *  rows so concurrent agents don't block each other. */
export async function getAgentNextRunAsync(agentId: string) {
  const db = await getDbAsync();
  await failStaleRunsAsync(db, agentId);

  // Capacity gate (cheap pre-check before opening a transaction)
  const agentRow = await db.get<{ max_concurrent_runs: number }>(
    `SELECT max_concurrent_runs FROM agents WHERE id = ?`, [agentId],
  );
  const maxConcurrent = Math.max(1, Math.min(10, Number(agentRow?.max_concurrent_runs) || 1));

  const runId = await db.transaction(async (tx) => {
    const countRow = await tx.get<{ c: number }>(
      `SELECT COUNT(*) as c FROM runs WHERE agent_id = ? AND status = 'running'`, [agentId],
    );
    if ((countRow?.c ?? 0) >= maxConcurrent) return null;

    const lock = forUpdateSkipLocked(tx);

    const pendingRun = await tx.get<{ id: string }>(
      `SELECT id FROM runs WHERE agent_id = ? AND status = 'pending' ORDER BY updated_at ASC LIMIT 1${lock}`,
      [agentId],
    );
    if (pendingRun) {
      await tx.run(`UPDATE runs SET status = 'running', updated_at = ${nowSql(tx)} WHERE id = ?`, [pendingRun.id]);
      return pendingRun.id;
    }

    const now = Math.floor(Date.now() / 1000);
    const scheduledRun = await tx.get<{ id: string }>(
      `SELECT id FROM runs WHERE agent_id = ? AND status = 'scheduled' AND scheduled_for <= ? ORDER BY scheduled_for ASC LIMIT 1${lock}`,
      [agentId, now],
    );
    if (scheduledRun) {
      await tx.run(
        `UPDATE runs SET status = 'running', claimed_at = ${nowSql(tx)}, updated_at = ${nowSql(tx)} WHERE id = ?`,
        [scheduledRun.id],
      );
      await tx.run(
        `UPDATE jobs SET last_run_at = ${nowSql(tx)}, updated_at = ${nowSql(tx)} WHERE id = (SELECT job_id FROM runs WHERE id = ?)`,
        [scheduledRun.id],
      );
      return scheduledRun.id;
    }

    // 3b. Team-handoff scheduled run: agent_id IS NULL, job team-assigned,
    // this agent is a role-eligible member. Adopting sets agent_id.
    const teamHandoffRun = await tx.get<{ id: string }>(
      `SELECT r.id FROM runs r
       JOIN jobs j ON r.job_id = j.id
       JOIN team_agents ta ON ta.team_id = j.team_id AND ta.agent_id = ?
       WHERE r.agent_id IS NULL AND r.status = 'scheduled' AND r.scheduled_for <= ?
         AND j.team_id IS NOT NULL
         AND (
           j.preferred_role IS NULL
           OR ta.role = j.preferred_role
           OR (
             j.role_fallback = 'any'
             AND NOT EXISTS (
               SELECT 1 FROM team_agents tam
               JOIN agents am ON am.id = tam.agent_id
               WHERE tam.team_id = j.team_id AND tam.role = j.preferred_role
                 AND (SELECT COUNT(*) FROM runs WHERE agent_id = am.id AND status = 'running') < am.max_concurrent_runs
             )
           )
         )
       ORDER BY (CASE WHEN ta.role = j.preferred_role THEN 0 ELSE 1 END), r.scheduled_for ASC
       LIMIT 1${lock}`,
      [agentId, now],
    );
    if (teamHandoffRun) {
      await tx.run(
        `UPDATE runs SET agent_id = ?, status = 'running', claimed_at = ${nowSql(tx)}, updated_at = ${nowSql(tx)} WHERE id = ?`,
        [agentId, teamHandoffRun.id],
      );
      await tx.run(
        `UPDATE jobs SET last_run_at = ${nowSql(tx)}, updated_at = ${nowSql(tx)} WHERE id = (SELECT job_id FROM runs WHERE id = ?)`,
        [teamHandoffRun.id],
      );
      return teamHandoffRun.id;
    }

    // Direct-assigned recurring job
    const readyJob = await tx.get<{ id: string; agent_id: string }>(
      `SELECT j.id, j.agent_id FROM jobs j
       WHERE j.agent_id = ? AND j.team_id IS NULL AND j.active = 1 AND j.one_off = 0
       AND j.next_run_at IS NOT NULL AND j.next_run_at <= ?
       AND NOT EXISTS (SELECT 1 FROM runs WHERE job_id = j.id AND status IN ('scheduled', 'running', 'waiting', 'pending'))
       ORDER BY j.next_run_at ASC LIMIT 1${lock}`,
      [agentId, now],
    );
    if (readyJob) {
      const newRunId = uuid();
      await tx.run(
        `INSERT INTO runs (id, job_id, agent_id, status, claimed_at) VALUES (?, ?, ?, 'running', ${nowSql(tx)})`,
        [newRunId, readyJob.id, agentId],
      );
      await tx.run(
        `UPDATE jobs SET last_run_at = ${nowSql(tx)}, updated_at = ${nowSql(tx)} WHERE id = ?`,
        [readyJob.id],
      );
      return newRunId;
    }

    // Team-assigned recurring job — role-priority + fallback semantics
    const teamJob = await tx.get<{ id: string; preferred_role: string | null; role_fallback: string; my_role: string }>(
      `SELECT j.id, j.preferred_role, j.role_fallback, ta.role AS my_role
       FROM jobs j
       JOIN team_agents ta ON ta.team_id = j.team_id AND ta.agent_id = ?
       WHERE j.team_id IS NOT NULL AND j.active = 1 AND j.one_off = 0
         AND j.next_run_at IS NOT NULL AND j.next_run_at <= ?
         AND NOT EXISTS (
           SELECT 1 FROM runs WHERE job_id = j.id AND status IN ('scheduled','running','waiting','pending')
         )
         AND (
           j.preferred_role IS NULL
           OR ta.role = j.preferred_role
           OR (
             j.role_fallback = 'any'
             AND NOT EXISTS (
               SELECT 1 FROM team_agents tam
               JOIN agents am ON am.id = tam.agent_id
               WHERE tam.team_id = j.team_id AND tam.role = j.preferred_role
                 AND (SELECT COUNT(*) FROM runs WHERE agent_id = am.id AND status = 'running') < am.max_concurrent_runs
             )
           )
         )
       ORDER BY (CASE WHEN ta.role = j.preferred_role THEN 0 ELSE 1 END), j.next_run_at ASC
       LIMIT 1${lock}`,
      [agentId, now],
    );
    if (teamJob) {
      const newRunId = uuid();
      await tx.run(
        `INSERT INTO runs (id, job_id, agent_id, status, claimed_at) VALUES (?, ?, ?, 'running', ${nowSql(tx)})`,
        [newRunId, teamJob.id, agentId],
      );
      await tx.run(
        `UPDATE jobs SET last_run_at = ${nowSql(tx)}, updated_at = ${nowSql(tx)} WHERE id = ?`,
        [teamJob.id],
      );
      return newRunId;
    }

    return null;
  });

  if (!runId) return null;
  // Advance the schedule outside the claim transaction (needs its own write).
  const run = await getRunByIdAsync(runId) as { job_id?: string } | null;
  if (run?.job_id) {
    const job = await db.get<{ one_off: number; next_run_at: number | null }>(
      `SELECT one_off, next_run_at FROM jobs WHERE id = ?`,
      [run.job_id],
    );
    if (job && !job.one_off) await advanceJobScheduleAsync(run.job_id);
  }
  return buildRunPayloadAsync(runId);
}

export async function getNextWorkflowRunAsync() {
  const db = await getDbAsync();
  const now = Math.floor(Date.now() / 1000);

  // Fail stale agentless workflow runs
  const stale = await db.all<{ id: string; timeout_minutes: number }>(
    `SELECT r.id, j.timeout_minutes FROM runs r
     JOIN jobs j ON r.job_id = j.id
     WHERE r.agent_id IS NULL AND r.status = 'running'
     AND r.updated_at + (j.timeout_minutes * 60) < ?`,
    [now],
  );
  for (const run of stale) {
    await db.run(
      `UPDATE runs SET status = 'failed', completed_at = ${nowSql(db)}, updated_at = ${nowSql(db)} WHERE id = ?`,
      [run.id],
    );
    await db.run(
      `INSERT INTO run_activity (id, run_id, author_type, author_name, content, created_at)
       VALUES (?, ?, 'system', 'System', ?, ${nowSql(db)})`,
      [uuid(), run.id, `Run timed out after ${run.timeout_minutes} minutes without completion.`],
    );
  }

  const runId = await db.transaction(async (tx) => {
    const lock = forUpdateSkipLocked(tx);
    const scheduledRun = await tx.get<{ id: string }>(
      `SELECT id FROM runs WHERE agent_id IS NULL AND status = 'scheduled' AND scheduled_for <= ? ORDER BY scheduled_for ASC LIMIT 1${lock}`,
      [now],
    );
    if (scheduledRun) {
      await tx.run(
        `UPDATE runs SET status = 'running', claimed_at = ${nowSql(tx)}, updated_at = ${nowSql(tx)} WHERE id = ?`,
        [scheduledRun.id],
      );
      await tx.run(
        `UPDATE jobs SET last_run_at = ${nowSql(tx)}, updated_at = ${nowSql(tx)} WHERE id = (SELECT job_id FROM runs WHERE id = ?)`,
        [scheduledRun.id],
      );
      return scheduledRun.id;
    }

    const readyJob = await tx.get<{ id: string }>(
      `SELECT j.id FROM jobs j
       WHERE j.agent_id IS NULL AND j.active = 1 AND j.one_off = 0
       AND j.workflow_only = 1 AND j.workflow_command IS NOT NULL
       AND j.next_run_at IS NOT NULL AND j.next_run_at <= ?
       AND NOT EXISTS (SELECT 1 FROM runs WHERE job_id = j.id AND status IN ('scheduled', 'running', 'waiting', 'pending'))
       ORDER BY j.next_run_at ASC LIMIT 1${lock}`,
      [now],
    );
    if (readyJob) {
      const newRunId = uuid();
      await tx.run(
        `INSERT INTO runs (id, job_id, agent_id, status, claimed_at) VALUES (?, ?, NULL, 'running', ${nowSql(tx)})`,
        [newRunId, readyJob.id],
      );
      await tx.run(
        `UPDATE jobs SET last_run_at = ${nowSql(tx)}, updated_at = ${nowSql(tx)} WHERE id = ?`,
        [readyJob.id],
      );
      return newRunId;
    }
    return null;
  });

  if (!runId) return null;
  const run = await getRunByIdAsync(runId) as { job_id?: string } | null;
  if (run?.job_id) {
    const job = await db.get<{ one_off: number }>(`SELECT one_off FROM jobs WHERE id = ?`, [run.job_id]);
    if (job && !job.one_off) await advanceJobScheduleAsync(run.job_id);
  }
  return buildRunPayloadAsync(runId);
}

export async function peekAgentNextAsync(agentId: string) {
  const db = await getDbAsync();
  await failStaleRunsAsync(db, agentId);

  const running = await db.get<{ id: string }>(`SELECT id FROM runs WHERE agent_id = ? AND status = 'running' LIMIT 1`, [agentId]);
  if (running) return { available: false, reason: "busy" };

  const pendingRun = await db.get<{ id: string; job_name: string }>(
    `SELECT r.id, j.name as job_name FROM runs r
     JOIN jobs j ON r.job_id = j.id
     WHERE r.agent_id = ? AND r.status = 'pending'
     ORDER BY r.updated_at ASC LIMIT 1`,
    [agentId],
  );
  if (pendingRun) {
    return { available: true, type: "pending_resume", run_id: pendingRun.id, job_name: pendingRun.job_name };
  }

  const now = Math.floor(Date.now() / 1000);
  const scheduledRun = await db.get<{ id: string; job_name: string }>(
    `SELECT r.id, j.name as job_name FROM runs r
     JOIN jobs j ON r.job_id = j.id
     WHERE r.agent_id = ? AND r.status = 'scheduled' AND r.scheduled_for <= ?
     ORDER BY r.scheduled_for ASC LIMIT 1`,
    [agentId, now],
  );
  if (scheduledRun) {
    return { available: true, type: "scheduled_run", run_id: scheduledRun.id, job_name: scheduledRun.job_name };
  }

  const readyJob = await db.get<{ id: string; name: string }>(
    `SELECT j.id, j.name FROM jobs j
     WHERE j.agent_id = ? AND j.active = 1 AND j.one_off = 0
     AND j.next_run_at IS NOT NULL AND j.next_run_at <= ?
     AND NOT EXISTS (SELECT 1 FROM runs WHERE job_id = j.id AND status IN ('scheduled', 'running', 'waiting', 'pending'))
     ORDER BY j.next_run_at ASC LIMIT 1`,
    [agentId, now],
  );
  if (readyJob) {
    return { available: true, type: "scheduled", job_id: readyJob.id, job_name: readyJob.name };
  }
  return { available: false, reason: "nothing_to_do" };
}

async function buildRunPayloadAsync(runId: string) {
  const db = await getDbAsync();
  const run = await getRunWithActivityAsync(runId) as Record<string, unknown> | null;
  if (!run) return null;
  const jobId = run.job_id as string;
  const job = await db.get<Record<string, unknown>>(`SELECT * FROM jobs WHERE id = ?`, [jobId]);
  if (!job) return null;

  const docs = await db.all(`
    SELECT d.id, d.title, dr.content
    FROM job_docs jd
    JOIN docs d ON jd.doc_id = d.id
    LEFT JOIN doc_revisions dr ON dr.doc_id = d.id
    AND dr.created_at = (SELECT MAX(created_at) FROM doc_revisions WHERE doc_id = d.id)
    WHERE jd.job_id = ?
  `, [jobId]);

  const linkedDbs = await db.all<{ name: string; table_name: string }>(`
    SELECT d.name, d.table_name
    FROM job_databases jd
    JOIN databases d ON jd.database_id = d.id
    WHERE jd.job_id = ?
  `, [jobId]);

  const orderCol = db.dialect === "postgres" ? "_id" : "rowid";
  const data: Record<string, unknown> = {};
  for (const d of linkedDbs) {
    data[d.name] = await db.all(`SELECT * FROM "${d.table_name}" ORDER BY ${orderCol} DESC LIMIT 100`);
  }

  const env = await getDecryptedEnvVarsForJobAsync(jobId);
  const attachments = await listAttachmentsByRunAsync(runId);

  let instructions = (job.instructions as string | null) || null;
  const extra = run.extra_instructions as string | null | undefined;
  if (extra) {
    instructions = instructions
      ? `${instructions}\n\n---\n\nAdditional instructions for this run:\n${extra}`
      : extra;
  }

  const agentId = run.agent_id as string | null;
  const agentRow = agentId
    ? await db.get<Record<string, unknown>>(
        `SELECT eager, permission_mode, api_base_url, api_key_env,
          can_read_docs, can_write_docs, can_read_databases, can_write_databases,
          can_read_env_vars, can_create_runs, can_create_handoffs,
          can_post_activity, can_update_status, can_use_shell
        FROM agents WHERE id = ?`,
        [agentId],
      )
    : null;
  const agent = agentRow ? {
    eager: !!agentRow.eager,
    permission_mode: agentRow.permission_mode,
    api_base_url: agentRow.api_base_url,
    api_key_env: agentRow.api_key_env,
    tool_permissions: {
      read_docs: !!agentRow.can_read_docs,
      write_docs: !!agentRow.can_write_docs,
      read_databases: !!agentRow.can_read_databases,
      write_databases: !!agentRow.can_write_databases,
      read_env_vars: !!agentRow.can_read_env_vars,
      create_runs: !!agentRow.can_create_runs,
      create_handoffs: !!agentRow.can_create_handoffs,
      post_activity: !!agentRow.can_post_activity,
      update_status: !!agentRow.can_update_status,
      use_shell: !!agentRow.can_use_shell,
    },
  } : undefined;

  return {
    run: { id: run.id, status: run.status, activity: run.activity },
    job: {
      id: job.id,
      name: job.name,
      instructions,
      workflow: job.workflow_command,
      workflow_only: !!job.workflow_only,
      model: job.model || null,
      thinking: job.thinking || null,
      timeout_minutes: (job.timeout_minutes as number) ?? 30,
    },
    ...(agent ? { agent } : {}),
    docs,
    data,
    env,
    attachments,
  };
}

