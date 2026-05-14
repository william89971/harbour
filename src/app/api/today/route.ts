import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import {
  listRunningRunsAsync,
  listWaitingRunsAsync,
  listCompletedTodayAsync,
  listSkippedTodayAsync,
  listFailedSinceAsync,
  listCompletedBetweenAsync,
  listFailedBetweenAsync,
} from "@/lib/db/runs";
import { listWorkflowRunsByStatusesAsync } from "@/lib/db/workflows";
import { listApprovalRequestsAsync } from "@/lib/db/autonomy";
import { countGoalsAsync } from "@/lib/db/goals";
import { countTasksByStatusAsync } from "@/lib/db/tasks";
import { listRecentDecisionsAsync } from "@/lib/db/decisions";
import { getTimezoneAsync } from "@/lib/db/settings";
import { getDbAsync } from "@/lib/db/schema";
import { computeSecurityStatus, type SecurityAgent } from "@/lib/security-status";
import { getGitHubSummaryAsync } from "@/lib/github";
import { getGmailPublicConfigAsync } from "@/lib/gmail";
import { countContactsByStatusAsync } from "@/lib/db/contacts";
import { countOutreachByStatusAsync } from "@/lib/db/outreach";
import { listAgentScorecardsAsync, type AgentScorecard } from "@/lib/db/scorecards";
import { startOfTodayUnix, startOfYesterdayUnix } from "@/lib/time";
import { isWeeklyReviewDue, listRecentWeeklyReviewsAsync } from "@/lib/weekly-review";

type Suggestion = { id: string; label: string; href: string; count?: number };

function buildSecurityCallouts(s: ReturnType<typeof computeSecurityStatus>): string[] {
  const out: string[] = [];
  if (s.unrestrictedAgents.length) out.push(`${s.unrestrictedAgents.length} unrestricted agent${s.unrestrictedAgents.length === 1 ? "" : "s"}`);
  if (s.customModeIssues.length) out.push(`${s.customModeIssues.length} agent${s.customModeIssues.length === 1 ? "" : "s"} with invalid settings.json`);
  if (s.workspaceCollisions.length) out.push(`${s.workspaceCollisions.length} workspace collision${s.workspaceCollisions.length === 1 ? "" : "s"}`);
  if (s.excessivePermissions.length) out.push(`${s.excessivePermissions.length} safe-mode agent${s.excessivePermissions.length === 1 ? "" : "s"} with excessive permissions`);
  if (s.apiAgentsWithoutStatus.length) out.push(`${s.apiAgentsWithoutStatus.length} API agent${s.apiAgentsWithoutStatus.length === 1 ? "" : "s"} without update_status permission`);
  return out;
}

export const GET = withAuth(async () => {
  const timezone = await getTimezoneAsync();
  const todayStart = startOfTodayUnix(timezone);
  const yesterdayStart = startOfYesterdayUnix(timezone);

  const db = await getDbAsync();
  const agentsP = db.all<SecurityAgent>(
    `SELECT id, name, cli, type, permission_mode, can_use_shell, can_read_env_vars, can_update_status FROM agents`,
  );
  const jobEnvVarsP = db.get<{ n: number }>(`SELECT COUNT(*) as n FROM job_env_vars`);

  const [
    pendingApprovals,
    waitingAndPendingRuns,
    runningRuns,
    completedDone,
    completedSkipped,
    failedRuns,
    completedYesterdayDone,
    failedYesterday,
    runningWorkflows,
    waitingWorkflows,
    failedWorkflows,
    agents,
    jobEnvVarsRow,
    activeGoalsCount,
    openTasksCount,
    blockedTasksCount,
    recentDecisions,
  ] = await Promise.all([
    listApprovalRequestsAsync({ status: "pending", limit: 50 }),
    listWaitingRunsAsync(),
    listRunningRunsAsync(),
    listCompletedTodayAsync(todayStart),
    listSkippedTodayAsync(todayStart),
    listFailedSinceAsync(todayStart),
    listCompletedBetweenAsync(yesterdayStart, todayStart),
    listFailedBetweenAsync(yesterdayStart, todayStart),
    listWorkflowRunsByStatusesAsync(["running"]),
    listWorkflowRunsByStatusesAsync(["waiting_for_approval"]),
    listWorkflowRunsByStatusesAsync(["failed", "rejected"], { sinceTs: todayStart }),
    agentsP,
    jobEnvVarsP,
    countGoalsAsync("active"),
    countTasksByStatusAsync(["todo", "doing"]),
    countTasksByStatusAsync(["blocked"]),
    listRecentDecisionsAsync(5),
  ]);

  // Growth — pre-aggregate counts + Gmail config (cheap).
  const [newContactsCount, draftCount, pendingApprovalCount, gmailPublic] = await Promise.all([
    countContactsByStatusAsync(["new"]),
    countOutreachByStatusAsync(["draft"]),
    countOutreachByStatusAsync(["pending_approval"]),
    getGmailPublicConfigAsync().catch(() => null),
  ]);
  const growthBlock = (newContactsCount + draftCount + pendingApprovalCount > 0) || gmailPublic?.configured
    ? {
        newContacts: newContactsCount,
        draftCount,
        pendingApprovalCount,
        gmailConfigured: !!gmailPublic?.configured,
      }
    : null;

  // Agent health — surfaces agents in distress.
  const scorecards = await listAgentScorecardsAsync().catch(() => [] as AgentScorecard[]);
  const failing = scorecards
    .filter(s => s.flags.failing)
    .sort((a, b) => (b.failure_rate ?? 0) - (a.failure_rate ?? 0))
    .slice(0, 5)
    .map(s => ({ id: s.agent_id, name: s.agent_name, failureRate: s.failure_rate ?? 0, totalRuns: s.total_runs }));
  const lowUsefulness = scorecards
    .filter(s => s.flags.low_usefulness)
    .sort((a, b) => (a.usefulness_ratio ?? 0) - (b.usefulness_ratio ?? 0))
    .slice(0, 5)
    .map(s => ({ id: s.agent_id, name: s.agent_name, usefulnessRatio: s.usefulness_ratio ?? 0, ratingCount: s.feedback_useful + s.feedback_not_useful }));
  const highCost = scorecards
    .filter(s => s.flags.high_cost)
    .sort((a, b) => b.total_cost_usd - a.total_cost_usd)
    .slice(0, 5)
    .map(s => ({ id: s.agent_id, name: s.agent_name, totalCostUsd: s.total_cost_usd }));
  const waitingAgents = scorecards
    .filter(s => s.flags.has_waiting)
    .sort((a, b) => b.waiting_runs - a.waiting_runs)
    .slice(0, 5)
    .map(s => ({ id: s.agent_id, name: s.agent_name, waitingRuns: s.waiting_runs }));
  const weakCount = failing.length + lowUsefulness.length + highCost.length;
  const agentHealthBlock = (failing.length + lowUsefulness.length + highCost.length + waitingAgents.length > 0)
    ? { failing, lowUsefulness, highCost, waiting: waitingAgents }
    : null;

  // GitHub summary — graceful: returns { configured: false } if unset.
  const githubSummary = await getGitHubSummaryAsync().catch(() => null);
  const githubBlock = githubSummary && githubSummary.configured
    ? {
        configured: true as const,
        repo: githubSummary.repo?.full_name ?? null,
        latestCommit: githubSummary.commits[0] ?? null,
        openIssuesCount: githubSummary.issues.length,
        openPRsCount: githubSummary.pullRequests.length,
        staleDays: githubSummary.staleDays,
      }
    : null;

  // Product Review Loop discovery — single small lookup so the Today page
  // can offer a "Start Product Review" CTA when the workflow is installed.
  const productReviewWorkflow = await db.get<{ id: string }>(
    `SELECT id FROM workflows WHERE name = ? LIMIT 1`,
    ["Product Review Loop"],
  );
  let productReviewActiveRunId: string | null = null;
  if (productReviewWorkflow?.id) {
    const activeRun = await db.get<{ id: string }>(
      `SELECT id FROM workflow_runs WHERE workflow_id = ? AND status IN ('running','waiting_for_approval') ORDER BY created_at DESC LIMIT 1`,
      [productReviewWorkflow.id],
    );
    productReviewActiveRunId = activeRun?.id ?? null;
  }

  const weeklyReviews = await listRecentWeeklyReviewsAsync(3).catch(() => []);
  const latestWeeklyReview = weeklyReviews[0] ?? null;
  const weeklyReviewDue = isWeeklyReviewDue(latestWeeklyReview);

  const securityStatus = computeSecurityStatus(agents, Number(jobEnvVarsRow?.n ?? 0));
  const securityCallouts = buildSecurityCallouts(securityStatus);

  const waitingRuns = (waitingAndPendingRuns as { status: string }[]).filter(r => r.status === "waiting");
  const pendingRuns = (waitingAndPendingRuns as { status: string }[]).filter(r => r.status === "pending");

  const suggestions: Suggestion[] = [];
  if (pendingApprovals.length > 0) {
    suggestions.push({
      id: "approvals",
      label: `Review ${pendingApprovals.length} pending approval${pendingApprovals.length === 1 ? "" : "s"}`,
      href: "/approvals",
      count: pendingApprovals.length,
    });
  }
  if (waitingWorkflows.length > 0) {
    suggestions.push({
      id: "workflow-gates",
      label: `Approve ${waitingWorkflows.length} workflow gate${waitingWorkflows.length === 1 ? "" : "s"}`,
      href: "#needs-you",
      count: waitingWorkflows.length,
    });
  }
  if (waitingRuns.length > 0) {
    suggestions.push({
      id: "waiting-runs",
      label: `Respond to ${waitingRuns.length} waiting agent${waitingRuns.length === 1 ? "" : "s"}`,
      href: "#needs-you",
      count: waitingRuns.length,
    });
  }
  if (failedRuns.length > 0) {
    suggestions.push({
      id: "failed-runs",
      label: `Investigate ${failedRuns.length} failed run${failedRuns.length === 1 ? "" : "s"} today`,
      href: "#failed-or-stuck",
      count: failedRuns.length,
    });
  }
  if (blockedTasksCount > 0) {
    suggestions.push({
      id: "blocked-tasks",
      label: `Unblock ${blockedTasksCount} task${blockedTasksCount === 1 ? "" : "s"}`,
      href: "/tasks?status=blocked",
      count: blockedTasksCount,
    });
  }
  if (githubBlock && githubBlock.staleDays !== null && githubBlock.staleDays > 7) {
    suggestions.push({
      id: "stale-repo",
      label: `Repo idle for ${githubBlock.staleDays} days`,
      href: "/integrations/github",
      count: githubBlock.staleDays,
    });
  }
  if (growthBlock && growthBlock.pendingApprovalCount > 0) {
    suggestions.push({
      id: "review-outreach",
      label: `Review ${growthBlock.pendingApprovalCount} outreach draft${growthBlock.pendingApprovalCount === 1 ? "" : "s"}`,
      href: "/outreach?status=pending_approval",
      count: growthBlock.pendingApprovalCount,
    });
  }
  if (weeklyReviewDue) {
    suggestions.push({
      id: "weekly-review",
      label: latestWeeklyReview ? "Run this week's Weekly Review" : "Run your first Weekly Review",
      href: "/weekly-reviews",
    });
  }
  if (growthBlock && growthBlock.newContacts === 0 && growthBlock.draftCount === 0 && growthBlock.pendingApprovalCount === 0) {
    suggestions.push({
      id: "find-prospects",
      label: "Add a prospect to begin growth",
      href: "/contacts",
    });
  }
  if (weakCount > 0) {
    suggestions.push({
      id: "weak-agents",
      label: `Review ${weakCount} weak agent${weakCount === 1 ? "" : "s"}`,
      href: "/agents/scorecards",
      count: weakCount,
    });
  }
  if (
    suggestions.length === 0 &&
    runningRuns.length === 0 &&
    completedDone.length === 0
  ) {
    suggestions.push({
      id: "trigger-job",
      label: "No activity yet today — trigger a job",
      href: "/jobs",
    });
  }

  return NextResponse.json({
    needsYou: {
      pendingApprovals,
      waitingRuns,
      pendingRuns,
      waitingWorkflowRuns: waitingWorkflows,
    },
    runningNow: {
      runs: runningRuns,
      workflowRuns: runningWorkflows,
    },
    failedOrStuck: {
      runs: failedRuns,
      workflowRuns: failedWorkflows,
    },
    completedToday: {
      done: completedDone,
      skipped: completedSkipped,
    },
    completedYesterday: {
      done: completedYesterdayDone,
      failed: failedYesterday,
    },
    activeWorkflows: [...runningWorkflows, ...waitingWorkflows],
    direction: {
      activeGoals: activeGoalsCount,
      openTasks: openTasksCount,
      blockedTasks: blockedTasksCount,
      recentDecisions,
    },
    productReview: productReviewWorkflow?.id
      ? { workflowId: productReviewWorkflow.id, activeRunId: productReviewActiveRunId }
      : null,
    weeklyReview: {
      latest: latestWeeklyReview
        ? {
            id: latestWeeklyReview.id,
            title: latestWeeklyReview.title,
            created_at: latestWeeklyReview.created_at,
            updated_at: latestWeeklyReview.updated_at,
            recommendations: latestWeeklyReview.recommendations,
          }
        : null,
      recent: weeklyReviews.map(review => ({
        id: review.id,
        title: review.title,
        created_at: review.created_at,
        updated_at: review.updated_at,
        recommendations: review.recommendations,
      })),
      due: weeklyReviewDue,
    },
    github: githubBlock,
    growth: growthBlock,
    agentHealth: agentHealthBlock,
    securityCallouts,
    suggestions,
    timezone,
    generatedAt: Math.floor(Date.now() / 1000),
  });
});
