import { getDbAsync } from "./schema";
import { countAgentFeedbackAsync } from "./feedback";

export type AgentScorecardFlags = {
  failing: boolean;
  low_usefulness: boolean;
  high_cost: boolean;
  has_waiting: boolean;
};

export type AgentScorecard = {
  agent_id: string;
  agent_name: string;
  total_runs: number;
  completed_runs: number;
  failed_runs: number;
  killed_runs: number;
  skipped_runs: number;
  waiting_runs: number;
  running_runs: number;
  success_rate: number | null;
  failure_rate: number | null;
  avg_runtime_seconds: number | null;
  total_cost_usd: number;
  avg_cost_usd: number | null;
  approvals_requested: number;
  approvals_approved: number;
  approvals_rejected: number;
  feedback_useful: number;
  feedback_not_useful: number;
  feedback_neutral: number;
  usefulness_ratio: number | null;
  last_run_at: number | null;
  last_successful_run_at: number | null;
  flags: AgentScorecardFlags;
};

const HIGH_COST_USD = 10;
const FAILING_RATE = 0.5;
const FAILING_MIN_RUNS = 3;
const LOW_USEFULNESS_RATIO = 0.4;
const LOW_USEFULNESS_MIN_RATINGS = 3;

type StatusRow = { status: string; n: number };
type CostRow = { total_cost_usd: number | null; completed_with_cost: number | null; avg_runtime: number | null };
type ApprovalRow = { status: string; n: number };
type LastRow = { last_run_at: number | null; last_successful_run_at: number | null };

function fraction(num: number, den: number): number | null {
  if (den <= 0) return null;
  return num / den;
}

export async function computeAgentScorecardAsync(agentId: string): Promise<AgentScorecard | null> {
  const db = await getDbAsync();
  const agent = await db.get<{ id: string; name: string }>(`SELECT id, name FROM agents WHERE id = ?`, [agentId]);
  if (!agent) return null;

  const [statusRows, costRow, approvalRows, lastRow, feedback] = await Promise.all([
    db.all<StatusRow>(
      `SELECT status AS status, COUNT(*) AS n
       FROM runs
       WHERE agent_id = ?
       GROUP BY status`,
      [agentId],
    ),
    db.get<CostRow>(
      `SELECT
         COALESCE(SUM(rc.estimated_cost_usd), 0) AS total_cost_usd,
         COUNT(rc.id) AS completed_with_cost,
         AVG(CASE WHEN r.completed_at IS NOT NULL AND r.claimed_at IS NOT NULL
                  THEN r.completed_at - r.claimed_at
                  ELSE NULL END) AS avg_runtime
       FROM runs r
       LEFT JOIN run_costs rc ON rc.run_id = r.id
       WHERE r.agent_id = ?`,
      [agentId],
    ),
    db.all<ApprovalRow>(
      `SELECT status AS status, COUNT(*) AS n
       FROM approval_requests
       WHERE requested_by_agent_id = ?
       GROUP BY status`,
      [agentId],
    ),
    db.get<LastRow>(
      `SELECT
         MAX(COALESCE(completed_at, updated_at, created_at)) AS last_run_at,
         MAX(CASE WHEN status = 'done' THEN COALESCE(completed_at, updated_at) ELSE NULL END) AS last_successful_run_at
       FROM runs
       WHERE agent_id = ?`,
      [agentId],
    ),
    countAgentFeedbackAsync(agentId),
  ]);

  const counts = {
    done: 0, failed: 0, killed: 0, skipped: 0, waiting: 0, pending: 0, running: 0, scheduled: 0,
  } as Record<string, number>;
  for (const row of statusRows) counts[row.status] = Number(row.n);

  const total_runs = Object.values(counts).reduce((a, b) => a + b, 0);
  const completed_runs = counts.done;
  const failed_runs = counts.failed;
  const killed_runs = counts.killed;
  const skipped_runs = counts.skipped;
  const running_runs = counts.running;
  const waiting_runs = counts.waiting + counts.pending;

  const terminalForRate = completed_runs + failed_runs + killed_runs;
  const success_rate = fraction(completed_runs, terminalForRate);
  const failure_rate = fraction(failed_runs + killed_runs, terminalForRate);

  const total_cost_usd = Number(costRow?.total_cost_usd ?? 0);
  const avg_cost_usd = completed_runs > 0 && total_cost_usd > 0 ? total_cost_usd / completed_runs : null;
  const avg_runtime_seconds = costRow?.avg_runtime != null ? Number(costRow.avg_runtime) : null;

  const approvals = { pending: 0, approved: 0, rejected: 0, expired: 0 } as Record<string, number>;
  for (const row of approvalRows) approvals[row.status] = Number(row.n);
  const approvals_requested = approvals.pending + approvals.approved + approvals.rejected + approvals.expired;
  const approvals_approved = approvals.approved;
  const approvals_rejected = approvals.rejected;

  const feedback_useful = feedback.useful;
  const feedback_not_useful = feedback.not_useful;
  const feedback_neutral = feedback.neutral;
  const ratedCount = feedback_useful + feedback_not_useful;
  const usefulness_ratio = ratedCount > 0 ? feedback_useful / ratedCount : null;

  const flags: AgentScorecardFlags = {
    failing: (failure_rate ?? 0) > FAILING_RATE && total_runs >= FAILING_MIN_RUNS,
    low_usefulness:
      usefulness_ratio !== null &&
      usefulness_ratio < LOW_USEFULNESS_RATIO &&
      ratedCount >= LOW_USEFULNESS_MIN_RATINGS,
    high_cost: total_cost_usd > HIGH_COST_USD,
    has_waiting: waiting_runs > 0,
  };

  return {
    agent_id: agentId,
    agent_name: agent.name,
    total_runs,
    completed_runs,
    failed_runs,
    killed_runs,
    skipped_runs,
    waiting_runs,
    running_runs,
    success_rate,
    failure_rate,
    avg_runtime_seconds,
    total_cost_usd,
    avg_cost_usd,
    approvals_requested,
    approvals_approved,
    approvals_rejected,
    feedback_useful,
    feedback_not_useful,
    feedback_neutral,
    usefulness_ratio,
    last_run_at: lastRow?.last_run_at ?? null,
    last_successful_run_at: lastRow?.last_successful_run_at ?? null,
    flags,
  };
}

export async function listAgentScorecardsAsync(): Promise<AgentScorecard[]> {
  const db = await getDbAsync();
  const agents = await db.all<{ id: string }>(`SELECT id FROM agents ORDER BY name`);
  const cards = await Promise.all(agents.map(a => computeAgentScorecardAsync(a.id)));
  return cards.filter((c): c is AgentScorecard => c !== null);
}
