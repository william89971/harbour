import { getDb, getDbAsync } from "./schema";
import { v4 as uuid } from "uuid";
import { estimateCostUsd } from "../ai-pricing";

export type CostInput = {
  provider: string | null;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
};

export type RunCost = {
  id: string;
  run_id: string;
  provider: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  estimated_cost_usd: number | null;
  pricing_known: number;
  created_at: number;
};

export function recordRunCost(runId: string, input: CostInput): RunCost | null {
  const db = getDb();
  const inputTokens = Math.max(0, Math.round(input.input_tokens ?? 0));
  const outputTokens = Math.max(0, Math.round(input.output_tokens ?? 0));
  const totalTokens = inputTokens + outputTokens;
  const { cost, known } = estimateCostUsd(input.provider, input.model, inputTokens, outputTokens);
  const id = uuid();

  db.prepare(`
    INSERT INTO run_costs (id, run_id, provider, model, input_tokens, output_tokens, total_tokens, estimated_cost_usd, pricing_known)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id) DO UPDATE SET
      provider = excluded.provider,
      model = excluded.model,
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      total_tokens = excluded.total_tokens,
      estimated_cost_usd = excluded.estimated_cost_usd,
      pricing_known = excluded.pricing_known
  `).run(
    id,
    runId,
    input.provider || null,
    input.model || null,
    inputTokens,
    outputTokens,
    totalTokens,
    cost,
    known ? 1 : 0,
  );

  return getRunCost(runId);
}

export function getRunCost(runId: string): RunCost | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM run_costs WHERE run_id = ?`).get(runId) as RunCost | undefined;
  return row || null;
}

export type CostSummary = {
  total_cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  run_count: number;
  unknown_pricing_runs: number;
};

const EMPTY_SUMMARY: CostSummary = {
  total_cost_usd: 0,
  input_tokens: 0,
  output_tokens: 0,
  total_tokens: 0,
  run_count: 0,
  unknown_pricing_runs: 0,
};

function summaryRow(row: unknown): CostSummary {
  if (!row || typeof row !== "object") return { ...EMPTY_SUMMARY };
  const r = row as Partial<Record<keyof CostSummary, number>>;
  return {
    total_cost_usd: r.total_cost_usd || 0,
    input_tokens: r.input_tokens || 0,
    output_tokens: r.output_tokens || 0,
    total_tokens: r.total_tokens || 0,
    run_count: r.run_count || 0,
    unknown_pricing_runs: r.unknown_pricing_runs || 0,
  };
}

const SUM_SELECT = `
  COALESCE(SUM(rc.estimated_cost_usd), 0) AS total_cost_usd,
  COALESCE(SUM(rc.input_tokens), 0) AS input_tokens,
  COALESCE(SUM(rc.output_tokens), 0) AS output_tokens,
  COALESCE(SUM(rc.total_tokens), 0) AS total_tokens,
  COUNT(rc.id) AS run_count,
  COALESCE(SUM(CASE WHEN rc.pricing_known = 0 THEN 1 ELSE 0 END), 0) AS unknown_pricing_runs
`;

export function sumCostsByAgent(agentId: string): CostSummary {
  const db = getDb();
  const row = db.prepare(`
    SELECT ${SUM_SELECT}
    FROM run_costs rc
    JOIN runs r ON rc.run_id = r.id
    WHERE r.agent_id = ?
  `).get(agentId);
  return summaryRow(row);
}

export function sumCostsByJob(jobId: string): CostSummary {
  const db = getDb();
  const row = db.prepare(`
    SELECT ${SUM_SELECT}
    FROM run_costs rc
    JOIN runs r ON rc.run_id = r.id
    WHERE r.job_id = ?
  `).get(jobId);
  return summaryRow(row);
}

export function sumCostsByProject(projectId: string): CostSummary {
  const db = getDb();
  const row = db.prepare(`
    SELECT ${SUM_SELECT}
    FROM run_costs rc
    JOIN runs r ON rc.run_id = r.id
    WHERE r.job_id IN (SELECT job_id FROM project_jobs WHERE project_id = ?)
  `).get(projectId);
  return summaryRow(row);
}

export function sumCostsTotal(projectId?: string): CostSummary {
  const db = getDb();
  if (projectId) return sumCostsByProject(projectId);
  const row = db.prepare(`SELECT ${SUM_SELECT} FROM run_costs rc`).get();
  return summaryRow(row);
}

export type ProviderBreakdown = {
  provider: string;
  model: string | null;
  total_cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  run_count: number;
};

export function breakdownByModel(projectId?: string): ProviderBreakdown[] {
  const db = getDb();
  const projectFilter = projectId
    ? `WHERE r.job_id IN (SELECT job_id FROM project_jobs WHERE project_id = ?)`
    : "";
  const args = projectId ? [projectId] : [];
  const rows = db.prepare(`
    SELECT
      COALESCE(rc.provider, 'unknown') AS provider,
      rc.model AS model,
      COALESCE(SUM(rc.estimated_cost_usd), 0) AS total_cost_usd,
      COALESCE(SUM(rc.input_tokens), 0) AS input_tokens,
      COALESCE(SUM(rc.output_tokens), 0) AS output_tokens,
      COUNT(rc.id) AS run_count
    FROM run_costs rc
    JOIN runs r ON rc.run_id = r.id
    ${projectFilter}
    GROUP BY rc.provider, rc.model
    ORDER BY total_cost_usd DESC
  `).all(...args) as ProviderBreakdown[];
  return rows;
}

export type AgentCostRow = {
  agent_id: string;
  agent_name: string;
  total_cost_usd: number;
  run_count: number;
};

export function topAgentsByCost(limit = 10, projectId?: string): AgentCostRow[] {
  const db = getDb();
  const projectFilter = projectId
    ? `AND r.job_id IN (SELECT job_id FROM project_jobs WHERE project_id = ?)`
    : "";
  const args: (string | number)[] = projectId ? [projectId, limit] : [limit];
  const rows = db.prepare(`
    SELECT
      a.id AS agent_id,
      a.name AS agent_name,
      COALESCE(SUM(rc.estimated_cost_usd), 0) AS total_cost_usd,
      COUNT(rc.id) AS run_count
    FROM run_costs rc
    JOIN runs r ON rc.run_id = r.id
    JOIN agents a ON r.agent_id = a.id
    WHERE 1=1 ${projectFilter}
    GROUP BY a.id, a.name
    ORDER BY total_cost_usd DESC
    LIMIT ?
  `).all(...args) as AgentCostRow[];
  return rows;
}

export type JobCostRow = {
  job_id: string;
  job_name: string;
  total_cost_usd: number;
  run_count: number;
};

export function topJobsByCost(limit = 10, projectId?: string): JobCostRow[] {
  const db = getDb();
  const projectFilter = projectId
    ? `AND r.job_id IN (SELECT job_id FROM project_jobs WHERE project_id = ?)`
    : "";
  const args: (string | number)[] = projectId ? [projectId, limit] : [limit];
  const rows = db.prepare(`
    SELECT
      j.id AS job_id,
      j.name AS job_name,
      COALESCE(SUM(rc.estimated_cost_usd), 0) AS total_cost_usd,
      COUNT(rc.id) AS run_count
    FROM run_costs rc
    JOIN runs r ON rc.run_id = r.id
    JOIN jobs j ON r.job_id = j.id
    WHERE 1=1 ${projectFilter}
    GROUP BY j.id, j.name
    ORDER BY total_cost_usd DESC
    LIMIT ?
  `).all(...args) as JobCostRow[];
  return rows;
}

// ---------------------------------------------------------------------------
// Async variants — cross-backend (SQLite + Postgres) via the adapter layer.
// ---------------------------------------------------------------------------

export async function recordRunCostAsync(runId: string, input: CostInput): Promise<RunCost | null> {
  const db = await getDbAsync();
  const inputTokens = Math.max(0, Math.round(input.input_tokens ?? 0));
  const outputTokens = Math.max(0, Math.round(input.output_tokens ?? 0));
  const totalTokens = inputTokens + outputTokens;
  const { cost, known } = estimateCostUsd(input.provider, input.model, inputTokens, outputTokens);
  const id = uuid();

  await db.run(`
    INSERT INTO run_costs (id, run_id, provider, model, input_tokens, output_tokens, total_tokens, estimated_cost_usd, pricing_known)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (run_id) DO UPDATE SET
      provider = excluded.provider,
      model = excluded.model,
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      total_tokens = excluded.total_tokens,
      estimated_cost_usd = excluded.estimated_cost_usd,
      pricing_known = excluded.pricing_known
  `, [id, runId, input.provider || null, input.model || null, inputTokens, outputTokens, totalTokens, cost, known ? 1 : 0]);

  // Cost ceiling: alert (not block) when the spend_money policy is exceeded.
  // Logged async-but-awaited so the test suite sees deterministic ordering.
  try {
    await checkCostCeilingAsync(runId, cost ?? 0);
  } catch (err) {
    console.error("[costs] autonomy ceiling check failed:", err);
  }

  return getRunCostAsync(runId);
}

/** Internal: consult the autonomy policy for spend_money on the given run.
 *  Records an approval_request when the ceiling is exceeded; never alters
 *  the run itself. Imported lazily to avoid pulling autonomy into every
 *  cost call when the policy table is empty. */
async function checkCostCeilingAsync(runId: string, costUsd: number): Promise<void> {
  if (!costUsd || costUsd <= 0) return;
  const db = await getDbAsync();
  const ctx = await db.get<{ agent_id: string | null; workflow_id: string | null; workflow_run_id: string | null; department: string | null }>(
    `SELECT r.agent_id AS agent_id,
            w.id AS workflow_id,
            sr.workflow_run_id AS workflow_run_id,
            w.department AS department
     FROM runs r
     LEFT JOIN workflow_step_runs sr ON sr.run_id = r.id
     LEFT JOIN workflow_steps s ON sr.step_id = s.id
     LEFT JOIN workflows w ON s.workflow_id = w.id
     WHERE r.id = ?
     LIMIT 1`,
    [runId],
  );
  const { evaluatePolicy } = await import("../autonomy/resolve");
  const { createApprovalRequestAsync } = await import("./autonomy");
  const decision = await evaluatePolicy({
    agentId: ctx?.agent_id ?? null,
    workflowId: ctx?.workflow_id ?? null,
    department: ctx?.department ?? null,
    actionType: "spend_money",
    costUsd,
  });
  if (decision.allow) return;

  // Dedup keys:
  // - workflow runs: one pending alert per workflow_run_id (so multi-step
  //   workflows that all breach the cap don't pile up duplicate alerts).
  // - one-off runs: one pending alert per run_id.
  if (ctx?.workflow_run_id) {
    const existingWf = await db.get<{ id: string }>(
      `SELECT a.id FROM approval_requests a
       JOIN workflow_step_runs sr ON sr.run_id = a.source_id
       WHERE a.source_type = 'cost' AND a.status = 'pending' AND sr.workflow_run_id = ?
       LIMIT 1`,
      [ctx.workflow_run_id],
    );
    if (existingWf) return;
  } else {
    const existing = await db.get<{ id: string }>(
      `SELECT id FROM approval_requests WHERE source_type = 'cost' AND source_id = ? AND status = 'pending' LIMIT 1`,
      [runId],
    );
    if (existing) return;
  }

  await createApprovalRequestAsync({
    sourceType: "cost",
    sourceId: runId,
    requestedByAgentId: ctx?.agent_id ?? null,
    actionType: "spend_money",
    riskLevel: decision.rule.risk_level,
    reason: decision.reason,
    payloadJson: JSON.stringify({ costUsd, workflowRunId: ctx?.workflow_run_id ?? null }),
  });

  // Surface the alert in the workflow_run activity log so operators see it on
  // the workflow-run timeline without having to crawl the approvals queue.
  if (ctx?.workflow_run_id) {
    await db.run(
      `INSERT INTO workflow_run_activity (id, workflow_run_id, step_run_id, author_type, author_name, kind, content)
       VALUES (?, ?, NULL, 'system', 'autonomy', 'status', ?)`,
      [
        uuid(),
        ctx.workflow_run_id,
        `Cost ceiling exceeded ($${costUsd.toFixed(4)}): ${decision.reason}`,
      ],
    );
  }
}

export async function getRunCostAsync(runId: string): Promise<RunCost | null> {
  const db = await getDbAsync();
  return db.get<RunCost>(`SELECT * FROM run_costs WHERE run_id = ?`, [runId]);
}

export async function sumCostsByAgentAsync(agentId: string): Promise<CostSummary> {
  const db = await getDbAsync();
  const row = await db.get(`
    SELECT ${SUM_SELECT}
    FROM run_costs rc
    JOIN runs r ON rc.run_id = r.id
    WHERE r.agent_id = ?
  `, [agentId]);
  return summaryRow(row);
}

export async function sumCostsByJobAsync(jobId: string): Promise<CostSummary> {
  const db = await getDbAsync();
  const row = await db.get(`
    SELECT ${SUM_SELECT}
    FROM run_costs rc
    JOIN runs r ON rc.run_id = r.id
    WHERE r.job_id = ?
  `, [jobId]);
  return summaryRow(row);
}

export async function sumCostsByProjectAsync(projectId: string): Promise<CostSummary> {
  const db = await getDbAsync();
  const row = await db.get(`
    SELECT ${SUM_SELECT}
    FROM run_costs rc
    JOIN runs r ON rc.run_id = r.id
    WHERE r.job_id IN (SELECT job_id FROM project_jobs WHERE project_id = ?)
  `, [projectId]);
  return summaryRow(row);
}

export async function sumCostsTotalAsync(projectId?: string): Promise<CostSummary> {
  if (projectId) return sumCostsByProjectAsync(projectId);
  const db = await getDbAsync();
  const row = await db.get(`SELECT ${SUM_SELECT} FROM run_costs rc`);
  return summaryRow(row);
}

export async function breakdownByModelAsync(projectId?: string): Promise<ProviderBreakdown[]> {
  const db = await getDbAsync();
  const projectFilter = projectId
    ? `WHERE r.job_id IN (SELECT job_id FROM project_jobs WHERE project_id = ?)`
    : "";
  const args = projectId ? [projectId] : [];
  return db.all<ProviderBreakdown>(`
    SELECT
      COALESCE(rc.provider, 'unknown') AS provider,
      rc.model AS model,
      COALESCE(SUM(rc.estimated_cost_usd), 0) AS total_cost_usd,
      COALESCE(SUM(rc.input_tokens), 0) AS input_tokens,
      COALESCE(SUM(rc.output_tokens), 0) AS output_tokens,
      COUNT(rc.id) AS run_count
    FROM run_costs rc
    JOIN runs r ON rc.run_id = r.id
    ${projectFilter}
    GROUP BY rc.provider, rc.model
    ORDER BY total_cost_usd DESC
  `, args);
}

export async function topAgentsByCostAsync(limit = 10, projectId?: string): Promise<AgentCostRow[]> {
  const db = await getDbAsync();
  const projectFilter = projectId
    ? `AND r.job_id IN (SELECT job_id FROM project_jobs WHERE project_id = ?)`
    : "";
  const args: (string | number)[] = projectId ? [projectId, limit] : [limit];
  return db.all<AgentCostRow>(`
    SELECT
      a.id AS agent_id,
      a.name AS agent_name,
      COALESCE(SUM(rc.estimated_cost_usd), 0) AS total_cost_usd,
      COUNT(rc.id) AS run_count
    FROM run_costs rc
    JOIN runs r ON rc.run_id = r.id
    JOIN agents a ON r.agent_id = a.id
    WHERE 1=1 ${projectFilter}
    GROUP BY a.id, a.name
    ORDER BY total_cost_usd DESC
    LIMIT ?
  `, args);
}

export async function topJobsByCostAsync(limit = 10, projectId?: string): Promise<JobCostRow[]> {
  const db = await getDbAsync();
  const projectFilter = projectId
    ? `AND r.job_id IN (SELECT job_id FROM project_jobs WHERE project_id = ?)`
    : "";
  const args: (string | number)[] = projectId ? [projectId, limit] : [limit];
  return db.all<JobCostRow>(`
    SELECT
      j.id AS job_id,
      j.name AS job_name,
      COALESCE(SUM(rc.estimated_cost_usd), 0) AS total_cost_usd,
      COUNT(rc.id) AS run_count
    FROM run_costs rc
    JOIN runs r ON rc.run_id = r.id
    JOIN jobs j ON r.job_id = j.id
    WHERE 1=1 ${projectFilter}
    GROUP BY j.id, j.name
    ORDER BY total_cost_usd DESC
    LIMIT ?
  `, args);
}
