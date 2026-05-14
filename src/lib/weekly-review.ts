import { getDbAsync } from "@/lib/db/schema";
import { createDocAsync } from "@/lib/db/docs";
import { getTimezoneAsync } from "@/lib/db/settings";
import { listAgentScorecardsAsync, type AgentScorecard } from "@/lib/db/scorecards";
import { getGitHubSummaryAsync, type GitHubSummary } from "@/lib/github";

const WEEK_SECONDS = 7 * 24 * 60 * 60;
const REVIEW_TITLE_PREFIX = "Weekly Review - ";
const MAX_LIST = 10;

type GoalRow = {
  id: string;
  title: string;
  notes: string | null;
  status: string;
  priority: string;
  target_date: number | null;
  updated_at: number;
};

type TaskRow = {
  id: string;
  title: string;
  notes: string | null;
  status: string;
  priority: string;
  goal_id: string | null;
  goal_title: string | null;
  updated_at: number;
};

type DecisionRow = {
  id: string;
  title: string;
  decision: string;
  rationale: string | null;
  created_at: number;
};

type RunRow = {
  id: string;
  status: string;
  job_name: string | null;
  agent_name: string | null;
  completed_at: number | null;
  updated_at: number;
};

type WorkflowRunRow = {
  id: string;
  status: string;
  workflow_name: string | null;
  current_step_name: string | null;
  completed_at: number | null;
  updated_at: number;
};

type CostSummary = {
  total_cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  run_count: number;
  unknown_pricing_runs: number;
};

type CostBreakdown = {
  provider: string;
  model: string | null;
  total_cost_usd: number;
  total_tokens: number;
  run_count: number;
};

type GrowthSummary = {
  newContacts: number;
  researchedContacts: number;
  contactedOrReplied: number;
  draftCount: number;
  pendingApprovalCount: number;
  sentCount: number;
};

type GoalProgress = {
  goalId: string;
  openTasks: number;
  doneThisWeek: number;
  blockedTasks: number;
};

export type WeeklyReviewData = {
  generatedAt: number;
  timezone: string;
  startTs: number;
  endTs: number;
  rangeLabel: string;
  goals: {
    active: GoalRow[];
    completedThisWeek: GoalRow[];
    progress: GoalProgress[];
  };
  tasks: {
    completed: TaskRow[];
    open: TaskRow[];
    blocked: TaskRow[];
  };
  decisions: DecisionRow[];
  runs: {
    completed: RunRow[];
    failed: RunRow[];
    killed: RunRow[];
    skipped: RunRow[];
  };
  workflows: {
    active: WorkflowRunRow[];
    failed: WorkflowRunRow[];
  };
  agents: AgentScorecard[];
  costs: {
    summary: CostSummary;
    breakdown: CostBreakdown[];
  };
  github: GitHubSummary | null;
  growth: GrowthSummary;
  pendingApprovals: number;
  recommendations: string[];
};

export type WeeklyReviewDoc = {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  content: string;
  recommendations: string[];
};

function asNumber(value: unknown): number {
  return Number(value ?? 0) || 0;
}

function datePart(ts: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ts * 1000));
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function reviewRangeLabel(startTs: number, endTs: number, timezone: string): string {
  return `${datePart(startTs, timezone)} to ${datePart(endTs - 1, timezone)}`;
}

function truncate<T>(items: T[], limit = MAX_LIST): { shown: T[]; hidden: number } {
  if (items.length <= limit) return { shown: items, hidden: 0 };
  return { shown: items.slice(0, limit), hidden: items.length - limit };
}

function bulletBlock<T>(items: T[], render: (item: T) => string, empty: string, limit = MAX_LIST): string {
  if (items.length === 0) return `- ${empty}`;
  const { shown, hidden } = truncate(items, limit);
  const lines = shown.map(item => `- ${render(item)}`);
  if (hidden > 0) lines.push(`- ...and ${hidden} more`);
  return lines.join("\n");
}

function runLabel(run: RunRow): string {
  const who = run.agent_name ? ` (${run.agent_name})` : "";
  return `${run.job_name ?? "(job)"}${who}`;
}

function workflowLabel(run: WorkflowRunRow): string {
  const step = run.current_step_name ? ` - ${run.current_step_name}` : "";
  return `${run.workflow_name ?? "(workflow)"}${step}`;
}

function money(n: number): string {
  return `$${n.toFixed(n >= 1 ? 2 : 4)}`;
}

function emptyCostSummary(): CostSummary {
  return {
    total_cost_usd: 0,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    run_count: 0,
    unknown_pricing_runs: 0,
  };
}

function buildRecommendations(data: Omit<WeeklyReviewData, "recommendations">): string[] {
  const out: string[] = [];
  const failedRuns = data.runs.failed.length + data.runs.killed.length;
  const weakAgents = data.agents.filter(a => a.flags.failing || a.flags.low_usefulness);
  const highCostAgents = data.agents.filter(a => a.flags.high_cost);

  if (data.tasks.blocked.length > 0) {
    out.push(`Unblock ${data.tasks.blocked.length} blocked task${data.tasks.blocked.length === 1 ? "" : "s"} before starting new work.`);
  }
  if (failedRuns > 0) {
    out.push(`Investigate ${failedRuns} failed or killed run${failedRuns === 1 ? "" : "s"} and decide retry, fix, or delete.`);
  }
  if (data.workflows.failed.length > 0) {
    out.push(`Resolve ${data.workflows.failed.length} failed workflow run${data.workflows.failed.length === 1 ? "" : "s"} before adding more automation.`);
  }
  if (data.pendingApprovals > 0) {
    out.push(`Clear ${data.pendingApprovals} pending approval${data.pendingApprovals === 1 ? "" : "s"}.`);
  }
  if (weakAgents.length > 0) {
    out.push(`Review ${weakAgents.length} weak agent scorecard${weakAgents.length === 1 ? "" : "s"} and adjust prompts, permissions, or ownership.`);
  }
  if (highCostAgents.length > 0) {
    out.push(`Audit high-cost agent usage for ${highCostAgents.slice(0, 2).map(a => a.agent_name).join(", ")}.`);
  }
  if (data.costs.summary.total_cost_usd > 0 && data.costs.breakdown[0]) {
    const top = data.costs.breakdown[0];
    out.push(`Review weekly AI spend: ${money(data.costs.summary.total_cost_usd)} total, led by ${top.provider}${top.model ? `/${top.model}` : ""}.`);
  }
  if (data.github?.configured) {
    if (data.github.staleDays !== null && data.github.staleDays > 7) {
      out.push(`Ship product work in ${data.github.repo?.full_name ?? "the configured repo"}; latest commit is ${data.github.staleDays} days old.`);
    }
    if (data.github.pullRequests.length > 0) {
      out.push(`Review or merge ${data.github.pullRequests.length} open pull request${data.github.pullRequests.length === 1 ? "" : "s"}.`);
    }
    if (data.github.issues.length > 0) {
      out.push(`Triage ${Math.min(data.github.issues.length, 3)} GitHub issue${Math.min(data.github.issues.length, 3) === 1 ? "" : "s"} that could block product progress.`);
    }
  }
  if (data.growth.pendingApprovalCount + data.growth.draftCount > 0) {
    const n = data.growth.pendingApprovalCount + data.growth.draftCount;
    out.push(`Review ${n} outreach draft${n === 1 ? "" : "s"} and either send, reject, or revise.`);
  } else if (data.growth.newContacts === 0 && data.growth.sentCount === 0) {
    out.push("Add at least one growth prospect or outreach task for next week.");
  }
  for (const goal of data.goals.active.slice(0, 3)) {
    out.push(`Choose one concrete next task for goal: ${goal.title}.`);
  }
  if (out.length === 0) {
    out.push("Choose one measurable priority for next week and turn it into a Task before Monday.");
  }
  return Array.from(new Set(out)).slice(0, 10);
}

export async function buildWeeklyReviewDataAsync(opts: {
  nowTs?: number;
  startTs?: number;
  endTs?: number;
} = {}): Promise<WeeklyReviewData> {
  const timezone = await getTimezoneAsync();
  const endTs = opts.endTs ?? opts.nowTs ?? Math.floor(Date.now() / 1000);
  const startTs = opts.startTs ?? (endTs - WEEK_SECONDS);
  const db = await getDbAsync();

  const [
    activeGoals,
    completedGoals,
    completedTasks,
    openTasks,
    blockedTasks,
    decisions,
    runs,
    activeWorkflows,
    failedWorkflows,
    scorecards,
    costRow,
    costBreakdownRows,
    growthRows,
    pendingApprovalRow,
    github,
  ] = await Promise.all([
    db.all<GoalRow>(
      `SELECT * FROM goals WHERE status = 'active' ORDER BY priority = 'high' DESC, updated_at DESC LIMIT 50`,
    ),
    db.all<GoalRow>(
      `SELECT * FROM goals WHERE status = 'completed' AND updated_at >= ? AND updated_at < ? ORDER BY updated_at DESC`,
      [startTs, endTs],
    ),
    db.all<TaskRow>(
      `SELECT t.*, g.title AS goal_title
       FROM tasks t
       LEFT JOIN goals g ON g.id = t.goal_id
       WHERE t.status = 'done' AND t.updated_at >= ? AND t.updated_at < ?
       ORDER BY t.updated_at DESC`,
      [startTs, endTs],
    ),
    db.all<TaskRow>(
      `SELECT t.*, g.title AS goal_title
       FROM tasks t
       LEFT JOIN goals g ON g.id = t.goal_id
       WHERE t.status IN ('todo','doing')
       ORDER BY CASE t.status WHEN 'doing' THEN 0 ELSE 1 END, t.updated_at DESC
       LIMIT 100`,
    ),
    db.all<TaskRow>(
      `SELECT t.*, g.title AS goal_title
       FROM tasks t
       LEFT JOIN goals g ON g.id = t.goal_id
       WHERE t.status = 'blocked'
       ORDER BY t.updated_at DESC
       LIMIT 100`,
    ),
    db.all<DecisionRow>(
      `SELECT * FROM decisions WHERE created_at >= ? AND created_at < ? ORDER BY created_at DESC`,
      [startTs, endTs],
    ),
    db.all<RunRow>(
      `SELECT r.id, r.status, r.completed_at, r.updated_at, j.name AS job_name, a.name AS agent_name
       FROM runs r
       JOIN jobs j ON j.id = r.job_id
       LEFT JOIN agents a ON a.id = r.agent_id
       WHERE r.completed_at IS NOT NULL AND r.completed_at >= ? AND r.completed_at < ?
       ORDER BY r.completed_at DESC
       LIMIT 300`,
      [startTs, endTs],
    ),
    db.all<WorkflowRunRow>(
      `SELECT wr.id, wr.status, wr.completed_at, wr.updated_at, w.name AS workflow_name, s.name AS current_step_name
       FROM workflow_runs wr
       LEFT JOIN workflows w ON w.id = wr.workflow_id
       LEFT JOIN workflow_steps s ON s.id = wr.current_step_id
       WHERE wr.status IN ('running','waiting_for_approval')
       ORDER BY wr.updated_at DESC
       LIMIT 100`,
    ),
    db.all<WorkflowRunRow>(
      `SELECT wr.id, wr.status, wr.completed_at, wr.updated_at, w.name AS workflow_name, s.name AS current_step_name
       FROM workflow_runs wr
       LEFT JOIN workflows w ON w.id = wr.workflow_id
       LEFT JOIN workflow_steps s ON s.id = wr.current_step_id
       WHERE wr.status IN ('failed','rejected') AND wr.completed_at IS NOT NULL AND wr.completed_at >= ? AND wr.completed_at < ?
       ORDER BY wr.completed_at DESC
       LIMIT 100`,
      [startTs, endTs],
    ),
    listAgentScorecardsAsync().catch(() => [] as AgentScorecard[]),
    db.get<CostSummary>(
      `SELECT
         COALESCE(SUM(rc.estimated_cost_usd), 0) AS total_cost_usd,
         COALESCE(SUM(rc.input_tokens), 0) AS input_tokens,
         COALESCE(SUM(rc.output_tokens), 0) AS output_tokens,
         COALESCE(SUM(rc.total_tokens), 0) AS total_tokens,
         COUNT(rc.id) AS run_count,
         COALESCE(SUM(CASE WHEN rc.pricing_known = 0 THEN 1 ELSE 0 END), 0) AS unknown_pricing_runs
       FROM run_costs rc
       JOIN runs r ON r.id = rc.run_id
       WHERE COALESCE(r.completed_at, rc.created_at) >= ? AND COALESCE(r.completed_at, rc.created_at) < ?`,
      [startTs, endTs],
    ),
    db.all<CostBreakdown>(
      `SELECT
         COALESCE(rc.provider, 'unknown') AS provider,
         rc.model AS model,
         COALESCE(SUM(rc.estimated_cost_usd), 0) AS total_cost_usd,
         COALESCE(SUM(rc.total_tokens), 0) AS total_tokens,
         COUNT(rc.id) AS run_count
       FROM run_costs rc
       JOIN runs r ON r.id = rc.run_id
       WHERE COALESCE(r.completed_at, rc.created_at) >= ? AND COALESCE(r.completed_at, rc.created_at) < ?
       GROUP BY rc.provider, rc.model
       ORDER BY total_cost_usd DESC
       LIMIT 10`,
      [startTs, endTs],
    ),
    Promise.all([
      db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM contacts WHERE status = 'new'`),
      db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM contacts WHERE status = 'researched'`),
      db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM contacts WHERE status IN ('contacted','replied') AND updated_at >= ? AND updated_at < ?`, [startTs, endTs]),
      db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM outreach_drafts WHERE status = 'draft'`),
      db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM outreach_drafts WHERE status = 'pending_approval'`),
      db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM outreach_drafts WHERE status = 'sent' AND updated_at >= ? AND updated_at < ?`, [startTs, endTs]),
    ]),
    db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM approval_requests WHERE status = 'pending'`),
    getGitHubSummaryAsync().catch(() => null),
  ]);

  const goalTaskRows = await db.all<{ goal_id: string; status: string; n: number }>(
    `SELECT goal_id, status, COUNT(*) AS n
     FROM tasks
     WHERE goal_id IS NOT NULL
     GROUP BY goal_id, status`,
  );
  const doneThisWeekByGoal = new Map<string, number>();
  for (const task of completedTasks) {
    if (task.goal_id) doneThisWeekByGoal.set(task.goal_id, (doneThisWeekByGoal.get(task.goal_id) ?? 0) + 1);
  }
  const progressByGoal = new Map<string, GoalProgress>();
  for (const goal of activeGoals) {
    progressByGoal.set(goal.id, {
      goalId: goal.id,
      openTasks: 0,
      doneThisWeek: doneThisWeekByGoal.get(goal.id) ?? 0,
      blockedTasks: 0,
    });
  }
  for (const row of goalTaskRows) {
    const progress = progressByGoal.get(row.goal_id);
    if (!progress) continue;
    if (row.status === "todo" || row.status === "doing") progress.openTasks += asNumber(row.n);
    if (row.status === "blocked") progress.blockedTasks += asNumber(row.n);
  }

  const dataWithoutRecommendations = {
    generatedAt: endTs,
    timezone,
    startTs,
    endTs,
    rangeLabel: reviewRangeLabel(startTs, endTs, timezone),
    goals: {
      active: activeGoals,
      completedThisWeek: completedGoals,
      progress: Array.from(progressByGoal.values()),
    },
    tasks: {
      completed: completedTasks,
      open: openTasks,
      blocked: blockedTasks,
    },
    decisions,
    runs: {
      completed: runs.filter(r => r.status === "done"),
      failed: runs.filter(r => r.status === "failed"),
      killed: runs.filter(r => r.status === "killed"),
      skipped: runs.filter(r => r.status === "skipped"),
    },
    workflows: {
      active: activeWorkflows,
      failed: failedWorkflows,
    },
    agents: scorecards,
    costs: {
      summary: costRow ? {
        total_cost_usd: asNumber(costRow.total_cost_usd),
        input_tokens: asNumber(costRow.input_tokens),
        output_tokens: asNumber(costRow.output_tokens),
        total_tokens: asNumber(costRow.total_tokens),
        run_count: asNumber(costRow.run_count),
        unknown_pricing_runs: asNumber(costRow.unknown_pricing_runs),
      } : emptyCostSummary(),
      breakdown: costBreakdownRows.map(row => ({
        provider: row.provider,
        model: row.model,
        total_cost_usd: asNumber(row.total_cost_usd),
        total_tokens: asNumber(row.total_tokens),
        run_count: asNumber(row.run_count),
      })),
    },
    github,
    growth: {
      newContacts: asNumber(growthRows[0]?.n),
      researchedContacts: asNumber(growthRows[1]?.n),
      contactedOrReplied: asNumber(growthRows[2]?.n),
      draftCount: asNumber(growthRows[3]?.n),
      pendingApprovalCount: asNumber(growthRows[4]?.n),
      sentCount: asNumber(growthRows[5]?.n),
    },
    pendingApprovals: asNumber(pendingApprovalRow?.n),
  };

  return {
    ...dataWithoutRecommendations,
    recommendations: buildRecommendations(dataWithoutRecommendations),
  };
}

export function renderWeeklyReviewMarkdown(data: WeeklyReviewData): string {
  const cost = data.costs.summary;
  const failedRuns = data.runs.failed.length + data.runs.killed.length;
  const githubCommitsThisWeek = (data.github?.commits ?? []).filter(c => {
    const t = Date.parse(c.date);
    return !Number.isNaN(t) && t / 1000 >= data.startTs && t / 1000 < data.endTs;
  });
  const flaggedAgents = data.agents.filter(a =>
    a.flags.failing || a.flags.low_usefulness || a.flags.high_cost || a.flags.has_waiting,
  );

  const parts = [
    `# Weekly Review - ${data.rangeLabel}`,
    `Generated ${datePart(data.generatedAt, data.timezone)} (${data.timezone}).`,
    "## Executive summary",
    [
      `- Active goals: ${data.goals.active.length}`,
      `- Completed tasks: ${data.tasks.completed.length}`,
      `- Blocked tasks: ${data.tasks.blocked.length}`,
      `- Decisions made: ${data.decisions.length}`,
      `- Runs: ${data.runs.completed.length} completed, ${data.runs.failed.length} failed, ${data.runs.killed.length} killed, ${data.runs.skipped.length} skipped`,
      `- Active workflows: ${data.workflows.active.length}`,
      `- Failed workflows: ${data.workflows.failed.length}`,
      `- Recorded usage: ${cost.run_count > 0 ? `${money(cost.total_cost_usd)} across ${cost.run_count} costed run${cost.run_count === 1 ? "" : "s"}` : "not available"}`,
    ].join("\n"),
    "## Goals progress",
    bulletBlock(data.goals.active, goal => {
      const progress = data.goals.progress.find(p => p.goalId === goal.id);
      const bits = [
        `${goal.title} [${goal.priority}]`,
        `${progress?.openTasks ?? 0} open task${(progress?.openTasks ?? 0) === 1 ? "" : "s"}`,
        `${progress?.doneThisWeek ?? 0} done this week`,
        `${progress?.blockedTasks ?? 0} blocked`,
      ];
      return bits.join(" - ");
    }, "No active goals."),
    data.goals.completedThisWeek.length > 0
      ? `Completed goals this week:\n${bulletBlock(data.goals.completedThisWeek, goal => goal.title, "None.")}`
      : "",
    "## Completed tasks",
    bulletBlock(data.tasks.completed, task => `${task.title}${task.goal_title ? ` - goal: ${task.goal_title}` : ""}`, "No tasks were marked done this week."),
    "## Blocked and open tasks",
    `Blocked:\n${bulletBlock(data.tasks.blocked, task => `${task.title} [${task.priority}]${task.goal_title ? ` - goal: ${task.goal_title}` : ""}`, "No blocked tasks.")}`,
    `Open:\n${bulletBlock(data.tasks.open, task => `${task.title} [${task.status}/${task.priority}]${task.goal_title ? ` - goal: ${task.goal_title}` : ""}`, "No open tasks.")}`,
    "## Key decisions made",
    bulletBlock(data.decisions, d => `${d.title}: ${d.decision}`, "No decisions recorded this week."),
    "## Runs completed, failed, killed, skipped",
    [
      `Completed:\n${bulletBlock(data.runs.completed, runLabel, "No completed runs.")}`,
      `Failed:\n${bulletBlock(data.runs.failed, runLabel, "No failed runs.")}`,
      `Killed:\n${bulletBlock(data.runs.killed, runLabel, "No killed runs.")}`,
      `Skipped:\n${bulletBlock(data.runs.skipped, runLabel, "No skipped runs.")}`,
    ].join("\n\n"),
    "## Active or failed workflows",
    [
      `Active:\n${bulletBlock(data.workflows.active, workflowLabel, "No active workflows.")}`,
      `Failed or rejected:\n${bulletBlock(data.workflows.failed, workflowLabel, "No failed workflows this week.")}`,
    ].join("\n\n"),
    "## Agent scorecard highlights",
    flaggedAgents.length === 0
      ? "- No agent scorecard flags."
      : bulletBlock(flaggedAgents, a => {
          const flags = [
            a.flags.failing ? "failing" : "",
            a.flags.low_usefulness ? "low usefulness" : "",
            a.flags.high_cost ? "high cost" : "",
            a.flags.has_waiting ? "waiting" : "",
          ].filter(Boolean).join(", ");
          const failure = a.failure_rate == null ? "n/a" : `${Math.round(a.failure_rate * 100)}%`;
          const costText = a.total_cost_usd > 0 ? ` - ${money(a.total_cost_usd)} total` : "";
          return `${a.agent_name}: ${flags}; ${a.total_runs} runs; failure ${failure}${costText}`;
        }, "No agent scorecard flags."),
    "## Cost and usage",
    cost.run_count === 0
      ? "- No recorded usage costs in this review window."
      : [
          `- Total: ${money(cost.total_cost_usd)} across ${cost.run_count} costed run${cost.run_count === 1 ? "" : "s"}`,
          `- Tokens: ${cost.total_tokens} total (${cost.input_tokens} input, ${cost.output_tokens} output)`,
          cost.unknown_pricing_runs > 0 ? `- Unknown pricing runs: ${cost.unknown_pricing_runs}` : "",
          data.costs.breakdown.length > 0
            ? `- Top models:\n${bulletBlock(data.costs.breakdown, row => `${row.provider}${row.model ? `/${row.model}` : ""}: ${money(row.total_cost_usd)} across ${row.run_count} run${row.run_count === 1 ? "" : "s"}`, "No model breakdown.")}`
            : "",
        ].filter(Boolean).join("\n"),
    "## GitHub and product progress",
    data.github?.configured
      ? [
          `- Repo: ${data.github.repo?.full_name ?? "(unknown)"}`,
          `- Commits this week: ${githubCommitsThisWeek.length}`,
          `- Open issues: ${data.github.issues.length}`,
          `- Open PRs: ${data.github.pullRequests.length}`,
          data.github.staleDays !== null ? `- Repo stale days: ${data.github.staleDays}` : "",
          githubCommitsThisWeek.length > 0
            ? `Recent commits:\n${bulletBlock(githubCommitsThisWeek, c => `${c.sha.slice(0, 7)} ${c.message} - ${c.author}`, "No commits this week.", 5)}`
            : "",
        ].filter(Boolean).join("\n")
      : "- GitHub integration is not configured or unavailable.",
    "## Growth and outreach progress",
    [
      `- New contacts: ${data.growth.newContacts}`,
      `- Researched contacts: ${data.growth.researchedContacts}`,
      `- Contacted/replied this week: ${data.growth.contactedOrReplied}`,
      `- Outreach drafts: ${data.growth.draftCount}`,
      `- Outreach pending approval: ${data.growth.pendingApprovalCount}`,
      `- Outreach sent this week: ${data.growth.sentCount}`,
    ].join("\n"),
    "## Recommended priorities for next week",
    data.recommendations.map(r => `- ${r}`).join("\n"),
  ];

  if (failedRuns === 0 && data.workflows.failed.length === 0 && data.tasks.blocked.length === 0) {
    parts.splice(3, 0, "- No failed runs, failed workflows, or blocked tasks were found in this review window.");
  }

  return parts.filter(part => part.trim().length > 0).join("\n\n") + "\n";
}

export function extractWeeklyReviewRecommendations(content: string): string[] {
  const match = /## Recommended priorities for next week\s*\n([\s\S]*?)(?:\n## |\n# |$)/i.exec(content || "");
  if (!match) return [];
  return match[1]
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith("- ") || /^\d+\.\s+/.test(line))
    .map(line => line.replace(/^-\s+/, "").replace(/^\d+\.\s+/, "").trim())
    .filter(Boolean);
}

export async function createWeeklyReviewDocAsync(opts: {
  actorType?: string;
  actorId?: string | null;
  nowTs?: number;
  startTs?: number;
  endTs?: number;
} = {}) {
  const data = await buildWeeklyReviewDataAsync(opts);
  const title = `${REVIEW_TITLE_PREFIX}${data.rangeLabel}`;
  const content = renderWeeklyReviewMarkdown(data);
  const doc = await createDocAsync(title, content, opts.actorType ?? "agent", opts.actorId ?? undefined);
  return { doc, review: data, content };
}

export async function listRecentWeeklyReviewsAsync(limit = 5): Promise<WeeklyReviewDoc[]> {
  const db = await getDbAsync();
  const capped = Math.max(1, Math.min(limit, 50));
  const rows = await db.all<{
    id: string;
    title: string;
    created_at: number;
    updated_at: number;
    content: string | null;
  }>(
    `SELECT d.id, d.title, d.created_at, d.updated_at,
       (SELECT dr.content FROM doc_revisions dr WHERE dr.doc_id = d.id ORDER BY dr.created_at DESC LIMIT 1) AS content
     FROM docs d
     WHERE LOWER(d.title) LIKE ?
     ORDER BY d.created_at DESC
     LIMIT ${capped}`,
    [`${REVIEW_TITLE_PREFIX.toLowerCase()}%`],
  );
  return rows.map(row => ({
    id: row.id,
    title: row.title,
    created_at: row.created_at,
    updated_at: row.updated_at,
    content: row.content ?? "",
    recommendations: extractWeeklyReviewRecommendations(row.content ?? ""),
  }));
}

export async function getWeeklyReviewJobStatusAsync() {
  const db = await getDbAsync();
  return db.get<{
    id: string;
    name: string;
    active: number;
    schedule: string;
    next_run_at: number | null;
    last_run_at: number | null;
  }>(
    `SELECT id, name, active, schedule, next_run_at, last_run_at
     FROM jobs
     WHERE name = ? AND workflow_only = 1 AND one_off = 0
     ORDER BY created_at DESC
     LIMIT 1`,
    ["Weekly Review"],
  );
}

export function isWeeklyReviewDue(latest: WeeklyReviewDoc | null, nowTs = Math.floor(Date.now() / 1000)): boolean {
  if (!latest) return true;
  return latest.created_at < nowTs - WEEK_SECONDS;
}

