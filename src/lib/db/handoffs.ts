import { getDb, getDbAsync } from "./schema";
import { nowSql } from "./dialect";
import { v4 as uuid } from "uuid";

export type HandoffStatus = "pending" | "accepted" | "completed" | "cancelled";

export type HandoffRow = {
  id: string;
  source_run_id: string | null;
  source_agent_id: string | null;
  target_agent_id: string | null;
  target_team_id: string | null;
  target_role: string | null;
  target_job_id: string | null;
  target_run_id: string | null;
  message: string;
  source_run_name_snapshot: string | null;
  source_agent_name_snapshot: string | null;
  status: HandoffStatus;
  created_at: number;
  updated_at: number;
};

export type HandoffInput = {
  targetAgentId?: string | null;
  targetTeamId?: string | null;
  targetRole?: string | null;
  message: string;
};

function validateHandoffInput(input: HandoffInput) {
  if (!input.message || !input.message.trim()) {
    throw new Error("message is required");
  }
  const hasAgent = !!input.targetAgentId;
  const hasTeam = !!input.targetTeamId;
  if (hasAgent === hasTeam) {
    throw new Error("exactly one of targetAgentId or targetTeamId is required");
  }
}

/** Embeds the source-run name + activity snapshot + the operator message into
 *  the target run's `instructions` field, so the target agent gets the full
 *  context on its first poll without any extra wiring. */
function buildHandoffInstructions({
  sourceRunId,
  sourceRunName,
  sourceAgentName,
  sourceInstructions,
  sourceActivity,
  message,
}: {
  sourceRunId: string;
  sourceRunName: string | null;
  sourceAgentName: string | null;
  sourceInstructions: string | null;
  sourceActivity: { author_type: string; author_name: string | null; content: string | null }[];
  message: string;
}): string {
  const lines: string[] = [];
  lines.push(`# Handoff from ${sourceAgentName || "another agent"}`);
  lines.push("");
  lines.push(`**Handoff message:**`);
  lines.push("");
  lines.push(message);
  lines.push("");
  if (sourceInstructions && sourceInstructions.trim()) {
    lines.push(`## Original instructions (from "${sourceRunName || sourceRunId}")`);
    lines.push("");
    lines.push(sourceInstructions);
    lines.push("");
  }
  if (sourceActivity.length > 0) {
    lines.push(`## Activity log from source run`);
    lines.push("");
    for (const a of sourceActivity) {
      const who = a.author_name || a.author_type;
      const body = (a.content || "").trim();
      if (body) {
        lines.push(`**${who}:** ${body}`);
        lines.push("");
      }
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Sync API (legacy — SQLite only)
// ---------------------------------------------------------------------------

export function createHandoff(sourceRunId: string, input: HandoffInput): HandoffRow {
  validateHandoffInput(input);
  const db = getDb();

  // Read source context once (outside the transaction is fine; we hold the
  // write lock for the duration of the inserts).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sourceRun = db.prepare(`
    SELECT r.*, j.name as job_name, j.instructions as job_instructions, j.agent_id as job_agent_id, a.name as agent_name
    FROM runs r
    JOIN jobs j ON r.job_id = j.id
    LEFT JOIN agents a ON r.agent_id = a.id
    WHERE r.id = ?
  `).get(sourceRunId) as any;
  if (!sourceRun) throw new Error("source run not found");

  const sourceActivity = db.prepare(
    `SELECT author_type, author_name, content FROM run_activity WHERE run_id = ? ORDER BY created_at ASC`,
  ).all(sourceRunId) as { author_type: string; author_name: string | null; content: string | null }[];

  const instructions = buildHandoffInstructions({
    sourceRunId,
    sourceRunName: sourceRun.job_name,
    sourceAgentName: sourceRun.agent_name,
    sourceInstructions: sourceRun.job_instructions,
    sourceActivity,
    message: input.message,
  });

  const handoffId = uuid();
  let targetJobId: string;
  let targetRunId: string;
  let targetAgentName: string | null = null;
  let targetTeamName: string | null = null;

  const run = db.transaction(() => {
    if (input.targetAgentId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const agent = db.prepare(`SELECT id, name FROM agents WHERE id = ?`).get(input.targetAgentId) as any;
      if (!agent) throw new Error("target agent not found");
      targetAgentName = agent.name;

      targetJobId = uuid();
      targetRunId = uuid();
      const now = Math.floor(Date.now() / 1000);
      db.prepare(`
        INSERT INTO jobs (id, agent_id, name, instructions, schedule, one_off, active, next_run_at)
        VALUES (?, ?, ?, ?, '{}', 1, 1, ?)
      `).run(targetJobId, input.targetAgentId, `Handoff from ${sourceRun.agent_name || "agent"}`, instructions, now);
      // Carry over linked docs / env vars from the source job.
      const docIds = (db.prepare(`SELECT doc_id FROM job_docs WHERE job_id = ?`).all(sourceRun.job_id) as { doc_id: string }[]).map(r => r.doc_id);
      for (const d of docIds) db.prepare(`INSERT OR IGNORE INTO job_docs (job_id, doc_id) VALUES (?, ?)`).run(targetJobId, d);
      const envIds = (db.prepare(`SELECT env_var_id FROM job_env_vars WHERE job_id = ?`).all(sourceRun.job_id) as { env_var_id: string }[]).map(r => r.env_var_id);
      for (const e of envIds) db.prepare(`INSERT OR IGNORE INTO job_env_vars (job_id, env_var_id) VALUES (?, ?)`).run(targetJobId, e);
      db.prepare(`
        INSERT INTO runs (id, job_id, agent_id, status, scheduled_for, created_at, updated_at)
        VALUES (?, ?, ?, 'scheduled', ?, ?, ?)
      `).run(targetRunId, targetJobId, input.targetAgentId, now, now, now);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const team = db.prepare(`SELECT id, name FROM teams WHERE id = ?`).get(input.targetTeamId) as any;
      if (!team) throw new Error("target team not found");
      targetTeamName = team.name;

      targetJobId = uuid();
      targetRunId = uuid();
      const now = Math.floor(Date.now() / 1000);
      db.prepare(`
        INSERT INTO jobs (id, agent_id, team_id, preferred_role, role_fallback,
                          name, instructions, schedule, one_off, active, next_run_at)
        VALUES (?, NULL, ?, ?, 'any', ?, ?, '{}', 1, 1, ?)
      `).run(
        targetJobId, input.targetTeamId, input.targetRole || null,
        `Handoff from ${sourceRun.agent_name || "agent"}`, instructions, now,
      );
      const docIds = (db.prepare(`SELECT doc_id FROM job_docs WHERE job_id = ?`).all(sourceRun.job_id) as { doc_id: string }[]).map(r => r.doc_id);
      for (const d of docIds) db.prepare(`INSERT OR IGNORE INTO job_docs (job_id, doc_id) VALUES (?, ?)`).run(targetJobId, d);
      const envIds = (db.prepare(`SELECT env_var_id FROM job_env_vars WHERE job_id = ?`).all(sourceRun.job_id) as { env_var_id: string }[]).map(r => r.env_var_id);
      for (const e of envIds) db.prepare(`INSERT OR IGNORE INTO job_env_vars (job_id, env_var_id) VALUES (?, ?)`).run(targetJobId, e);
      db.prepare(`
        INSERT INTO runs (id, job_id, agent_id, status, scheduled_for, created_at, updated_at)
        VALUES (?, ?, NULL, 'scheduled', ?, ?, ?)
      `).run(targetRunId, targetJobId, now, now, now);
    }

    db.prepare(`
      INSERT INTO run_handoffs
        (id, source_run_id, source_agent_id, target_agent_id, target_team_id, target_role,
         target_job_id, target_run_id, message,
         source_run_name_snapshot, source_agent_name_snapshot, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(
      handoffId, sourceRunId, sourceRun.agent_id || null,
      input.targetAgentId || null, input.targetTeamId || null, input.targetRole || null,
      targetJobId!, targetRunId!, input.message,
      sourceRun.job_name || null, sourceRun.agent_name || null,
    );

    // System activity on both runs. Bold target description, link source.
    const targetDesc = input.targetAgentId
      ? `**${targetAgentName || "agent"}**`
      : `team **${targetTeamName || "team"}**${input.targetRole ? ` (role: ${input.targetRole})` : ""}`;
    const sourceActId = uuid();
    db.prepare(`
      INSERT INTO run_activity (id, run_id, author_type, author_id, author_name, content)
      VALUES (?, ?, 'system', NULL, 'System', ?)
    `).run(sourceActId, sourceRunId, `Handed off to ${targetDesc}: ${input.message}`);
    const sourceRunName = sourceRun.job_name || sourceRunId;
    const targetActId = uuid();
    db.prepare(`
      INSERT INTO run_activity (id, run_id, author_type, author_id, author_name, content)
      VALUES (?, ?, 'system', NULL, 'System', ?)
    `).run(targetActId, targetRunId!, `Received handoff from **${sourceRun.agent_name || "an agent"}** on [${sourceRunName}](/runs/${sourceRunId}): ${input.message}`);

    return handoffId;
  });
  run();
  return getHandoffById(handoffId)!;
}

export function getHandoffById(id: string): HandoffRow | null {
  const db = getDb();
  return db.prepare(`SELECT * FROM run_handoffs WHERE id = ?`).get(id) as HandoffRow | undefined || null;
}

type OutgoingHandoffRow = HandoffRow & {
  target_agent_name: string | null;
  target_team_name: string | null;
  target_run_status: string | null;
};

export function listOutgoingHandoffs(sourceRunId: string): OutgoingHandoffRow[] {
  const db = getDb();
  return db.prepare(`
    SELECT h.*,
      ta.name AS target_agent_name,
      tt.name AS target_team_name,
      tr.status AS target_run_status
    FROM run_handoffs h
    LEFT JOIN agents ta ON h.target_agent_id = ta.id
    LEFT JOIN teams tt ON h.target_team_id = tt.id
    LEFT JOIN runs tr ON h.target_run_id = tr.id
    WHERE h.source_run_id = ?
    ORDER BY h.created_at ASC
  `).all(sourceRunId) as OutgoingHandoffRow[];
}

type IncomingHandoffRow = HandoffRow & {
  source_agent_name: string | null;
  source_run_status: string | null;
  source_run_job_name: string | null;
};

export function listIncomingHandoff(targetRunId: string): IncomingHandoffRow | null {
  const db = getDb();
  return db.prepare(`
    SELECT h.*,
      sa.name AS source_agent_name,
      sr.status AS source_run_status,
      sj.name AS source_run_job_name
    FROM run_handoffs h
    LEFT JOIN agents sa ON h.source_agent_id = sa.id
    LEFT JOIN runs sr ON h.source_run_id = sr.id
    LEFT JOIN jobs sj ON sr.job_id = sj.id
    WHERE h.target_run_id = ?
    LIMIT 1
  `).get(targetRunId) as IncomingHandoffRow | undefined || null;
}

export function findHandoffsByTargetRun(targetRunId: string): HandoffRow[] {
  const db = getDb();
  return db.prepare(`SELECT * FROM run_handoffs WHERE target_run_id = ?`).all(targetRunId) as HandoffRow[];
}

/** Direct status setter. updateRunStatus calls this automatically on the
 *  appropriate transitions; expose for explicit cancel from a future endpoint. */
export function markHandoffStatus(id: string, status: HandoffStatus) {
  const db = getDb();
  db.prepare(`UPDATE run_handoffs SET status = ?, updated_at = unixepoch() WHERE id = ?`).run(status, id);
}

// ---------------------------------------------------------------------------
// Async variants — cross-backend (SQLite + Postgres) via the adapter layer.
// ---------------------------------------------------------------------------

export async function createHandoffAsync(sourceRunId: string, input: HandoffInput): Promise<HandoffRow> {
  validateHandoffInput(input);
  const db = await getDbAsync();

  const sourceRun = await db.get<{
    id: string;
    agent_id: string | null;
    job_id: string;
    job_name: string;
    job_instructions: string | null;
    agent_name: string | null;
  }>(`
    SELECT r.id, r.agent_id, r.job_id, j.name as job_name, j.instructions as job_instructions, a.name as agent_name
    FROM runs r
    JOIN jobs j ON r.job_id = j.id
    LEFT JOIN agents a ON r.agent_id = a.id
    WHERE r.id = ?
  `, [sourceRunId]);
  if (!sourceRun) throw new Error("source run not found");

  const sourceActivity = await db.all<{ author_type: string; author_name: string | null; content: string | null }>(
    `SELECT author_type, author_name, content FROM run_activity WHERE run_id = ? ORDER BY created_at ASC`,
    [sourceRunId],
  );

  const instructions = buildHandoffInstructions({
    sourceRunId,
    sourceRunName: sourceRun.job_name,
    sourceAgentName: sourceRun.agent_name,
    sourceInstructions: sourceRun.job_instructions,
    sourceActivity,
    message: input.message,
  });

  const handoffId = uuid();
  let targetJobId = "";
  let targetRunId = "";
  let targetAgentName: string | null = null;
  let targetTeamName: string | null = null;
  let existingHandoffId: string | null = null;

  await db.transaction(async (tx) => {
    // Idempotency: if the same source run has already created a handoff with
    // the same target + message, return that existing handoff instead of
    // inserting another. Without this guard, a retried POST (network jitter,
    // agent retry loop) creates duplicate handoff rows AND duplicate target
    // runs, which is both noisy and a small DoS vector.
    const dup = await tx.get<{ id: string }>(
      `SELECT id FROM run_handoffs
        WHERE source_run_id = ?
          AND COALESCE(target_agent_id, '') = COALESCE(?, '')
          AND COALESCE(target_team_id, '') = COALESCE(?, '')
          AND COALESCE(target_role, '') = COALESCE(?, '')
          AND message = ?
        LIMIT 1`,
      [sourceRunId, input.targetAgentId || null, input.targetTeamId || null, input.targetRole || null, input.message],
    );
    if (dup) {
      existingHandoffId = dup.id;
      return;
    }

    if (input.targetAgentId) {
      const agent = await tx.get<{ id: string; name: string }>(`SELECT id, name FROM agents WHERE id = ?`, [input.targetAgentId]);
      if (!agent) throw new Error("target agent not found");
      targetAgentName = agent.name;

      targetJobId = uuid();
      targetRunId = uuid();
      const now = Math.floor(Date.now() / 1000);
      await tx.run(`
        INSERT INTO jobs (id, agent_id, name, instructions, schedule, one_off, active, next_run_at)
        VALUES (?, ?, ?, ?, '{}', 1, 1, ?)
      `, [targetJobId, input.targetAgentId, `Handoff from ${sourceRun.agent_name || "agent"}`, instructions, now]);
      const docs = await tx.all<{ doc_id: string }>(`SELECT doc_id FROM job_docs WHERE job_id = ?`, [sourceRun.job_id]);
      for (const d of docs) await tx.run(`INSERT INTO job_docs (job_id, doc_id) VALUES (?, ?) ON CONFLICT DO NOTHING`, [targetJobId, d.doc_id]);
      const envs = await tx.all<{ env_var_id: string }>(`SELECT env_var_id FROM job_env_vars WHERE job_id = ?`, [sourceRun.job_id]);
      for (const e of envs) await tx.run(`INSERT INTO job_env_vars (job_id, env_var_id) VALUES (?, ?) ON CONFLICT DO NOTHING`, [targetJobId, e.env_var_id]);
      await tx.run(`
        INSERT INTO runs (id, job_id, agent_id, status, scheduled_for, created_at, updated_at)
        VALUES (?, ?, ?, 'scheduled', ?, ?, ?)
      `, [targetRunId, targetJobId, input.targetAgentId, now, now, now]);
    } else {
      const team = await tx.get<{ id: string; name: string }>(`SELECT id, name FROM teams WHERE id = ?`, [input.targetTeamId!]);
      if (!team) throw new Error("target team not found");
      targetTeamName = team.name;

      targetJobId = uuid();
      targetRunId = uuid();
      const now = Math.floor(Date.now() / 1000);
      await tx.run(`
        INSERT INTO jobs (id, agent_id, team_id, preferred_role, role_fallback,
                          name, instructions, schedule, one_off, active, next_run_at)
        VALUES (?, NULL, ?, ?, 'any', ?, ?, '{}', 1, 1, ?)
      `, [
        targetJobId, input.targetTeamId || null, input.targetRole || null,
        `Handoff from ${sourceRun.agent_name || "agent"}`, instructions, now,
      ]);
      const docs = await tx.all<{ doc_id: string }>(`SELECT doc_id FROM job_docs WHERE job_id = ?`, [sourceRun.job_id]);
      for (const d of docs) await tx.run(`INSERT INTO job_docs (job_id, doc_id) VALUES (?, ?) ON CONFLICT DO NOTHING`, [targetJobId, d.doc_id]);
      const envs = await tx.all<{ env_var_id: string }>(`SELECT env_var_id FROM job_env_vars WHERE job_id = ?`, [sourceRun.job_id]);
      for (const e of envs) await tx.run(`INSERT INTO job_env_vars (job_id, env_var_id) VALUES (?, ?) ON CONFLICT DO NOTHING`, [targetJobId, e.env_var_id]);
      await tx.run(`
        INSERT INTO runs (id, job_id, agent_id, status, scheduled_for, created_at, updated_at)
        VALUES (?, ?, NULL, 'scheduled', ?, ?, ?)
      `, [targetRunId, targetJobId, now, now, now]);
    }

    await tx.run(`
      INSERT INTO run_handoffs
        (id, source_run_id, source_agent_id, target_agent_id, target_team_id, target_role,
         target_job_id, target_run_id, message,
         source_run_name_snapshot, source_agent_name_snapshot, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `, [
      handoffId, sourceRunId, sourceRun.agent_id || null,
      input.targetAgentId || null, input.targetTeamId || null, input.targetRole || null,
      targetJobId, targetRunId, input.message,
      sourceRun.job_name || null, sourceRun.agent_name || null,
    ]);

    const targetDesc = input.targetAgentId
      ? `**${targetAgentName || "agent"}**`
      : `team **${targetTeamName || "team"}**${input.targetRole ? ` (role: ${input.targetRole})` : ""}`;
    const sourceRunName = sourceRun.job_name || sourceRunId;
    await tx.run(
      `INSERT INTO run_activity (id, run_id, author_type, author_id, author_name, content) VALUES (?, ?, 'system', NULL, 'System', ?)`,
      [uuid(), sourceRunId, `Handed off to ${targetDesc}: ${input.message}`],
    );
    await tx.run(
      `INSERT INTO run_activity (id, run_id, author_type, author_id, author_name, content) VALUES (?, ?, 'system', NULL, 'System', ?)`,
      [uuid(), targetRunId, `Received handoff from **${sourceRun.agent_name || "an agent"}** on [${sourceRunName}](/runs/${sourceRunId}): ${input.message}`],
    );
  });
  const row = await getHandoffByIdAsync(existingHandoffId || handoffId);
  return row!;
}

export async function getHandoffByIdAsync(id: string): Promise<HandoffRow | null> {
  const db = await getDbAsync();
  return db.get<HandoffRow>(`SELECT * FROM run_handoffs WHERE id = ?`, [id]);
}

export async function listOutgoingHandoffsAsync(sourceRunId: string) {
  const db = await getDbAsync();
  return db.all(`
    SELECT h.*,
      ta.name AS target_agent_name,
      tt.name AS target_team_name,
      tr.status AS target_run_status
    FROM run_handoffs h
    LEFT JOIN agents ta ON h.target_agent_id = ta.id
    LEFT JOIN teams tt ON h.target_team_id = tt.id
    LEFT JOIN runs tr ON h.target_run_id = tr.id
    WHERE h.source_run_id = ?
    ORDER BY h.created_at ASC
  `, [sourceRunId]);
}

export async function listIncomingHandoffAsync(targetRunId: string) {
  const db = await getDbAsync();
  return db.get(`
    SELECT h.*,
      sa.name AS source_agent_name,
      sr.status AS source_run_status,
      sj.name AS source_run_job_name
    FROM run_handoffs h
    LEFT JOIN agents sa ON h.source_agent_id = sa.id
    LEFT JOIN runs sr ON h.source_run_id = sr.id
    LEFT JOIN jobs sj ON sr.job_id = sj.id
    WHERE h.target_run_id = ?
    LIMIT 1
  `, [targetRunId]);
}

export async function markHandoffStatusAsync(id: string, status: HandoffStatus) {
  const db = await getDbAsync();
  await db.run(`UPDATE run_handoffs SET status = ?, updated_at = ${nowSql(db)} WHERE id = ?`, [status, id]);
}
