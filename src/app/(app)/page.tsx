"use client";

/**
 * Today — the operator's command center.
 *
 * Reads from a single GET /api/today aggregator and renders six sections:
 * suggested next moves, needs you, running now, active workflows,
 * failed or stuck, completed today.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  AlertTriangle,
  Bot,
  Building2,
  CalendarCheck,
  CheckSquare,
  ChevronRight,
  CircleCheck,
  GitBranch,
  GitCommit,
  Inbox,
  Play,
  Scale,
  Send,
  ShieldAlert,
  Target,
  Terminal,
  Users,
  Workflow as WorkflowIcon,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SectionHeader } from "@/components/app/section-header";
import { EmptyState } from "@/components/app/empty-state";
import { RunStatusIcon } from "@/components/app/run-status";
import { RoleGate } from "@/components/app/role-gate";
import { useRouter } from "next/navigation";
import { timeAgo } from "@/lib/time";

type Run = {
  id: string;
  status: string;
  job_id: string;
  job_name: string;
  agent_name: string | null;
  job_workflow_command: string | null;
  job_workflow_only: number;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
};

type WorkflowRun = {
  id: string;
  workflow_id: string;
  status: "running" | "waiting_for_approval" | "done" | "failed" | "rejected";
  current_step_id: string | null;
  current_step_name: string | null;
  workflow_name: string | null;
  started_at: number | null;
  completed_at: number | null;
  created_at: number;
  updated_at: number;
};

type Approval = {
  id: string;
  source_type: string;
  source_id: string;
  action_type: string;
  risk_level: "low" | "medium" | "high";
  reason: string | null;
  status: string;
  created_at: number;
};

type Suggestion = { id: string; label: string; href: string; count?: number };

type DecisionSummary = {
  id: string;
  title: string;
  decision: string;
  created_at: number;
};

type TodayResponse = {
  needsYou: {
    pendingApprovals: Approval[];
    waitingRuns: Run[];
    pendingRuns: Run[];
    waitingWorkflowRuns: WorkflowRun[];
  };
  runningNow: { runs: Run[]; workflowRuns: WorkflowRun[] };
  failedOrStuck: { runs: Run[]; workflowRuns: WorkflowRun[] };
  completedToday: { done: Run[]; skipped: Run[] };
  activeWorkflows: WorkflowRun[];
  direction?: {
    activeGoals: number;
    openTasks: number;
    blockedTasks: number;
    recentDecisions: DecisionSummary[];
  };
  productReview?: { workflowId: string; activeRunId: string | null } | null;
  weeklyReview?: {
    latest: {
      id: string;
      title: string;
      created_at: number;
      updated_at: number;
      recommendations: string[];
    } | null;
    recent: {
      id: string;
      title: string;
      created_at: number;
      updated_at: number;
      recommendations: string[];
    }[];
    due: boolean;
  };
  growth?: {
    newContacts: number;
    draftCount: number;
    pendingApprovalCount: number;
    gmailConfigured: boolean;
  } | null;
  agentHealth?: {
    failing: { id: string; name: string; failureRate: number; totalRuns: number }[];
    lowUsefulness: { id: string; name: string; usefulnessRatio: number; ratingCount: number }[];
    highCost: { id: string; name: string; totalCostUsd: number }[];
    waiting: { id: string; name: string; waitingRuns: number }[];
  } | null;
  github?: {
    configured: boolean;
    repo: string | null;
    latestCommit: { sha: string; message: string; author: string; html_url: string; date: string } | null;
    openIssuesCount: number;
    openPRsCount: number;
    staleDays: number | null;
  } | null;
  suggestions: Suggestion[];
  timezone: string;
  generatedAt: number;
};

export default function TodayPage() {
  const { data, isLoading } = useQuery<TodayResponse>({
    queryKey: ["today"],
    queryFn: async () => {
      const res = await fetch("/api/today");
      if (!res.ok) throw new Error("Failed to load Today");
      return res.json();
    },
    refetchInterval: 10_000,
  });

  if (isLoading || !data) {
    return <div className="text-sm text-muted-foreground py-12 text-center">Loading...</div>;
  }

  const { needsYou, runningNow, failedOrStuck, completedToday, activeWorkflows, suggestions, direction, productReview, weeklyReview, github, growth, agentHealth } = data;
  const needsYouCount =
    needsYou.pendingApprovals.length +
    needsYou.waitingRuns.length +
    needsYou.pendingRuns.length +
    needsYou.waitingWorkflowRuns.length;
  const runningCount = runningNow.runs.length + runningNow.workflowRuns.length;
  const failedCount = failedOrStuck.runs.length + failedOrStuck.workflowRuns.length;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
        <p className="text-sm text-muted-foreground mt-1">
          What needs you, what&apos;s moving, and what just finished.
        </p>
      </div>

      {direction && (direction.activeGoals + direction.openTasks + direction.blockedTasks + direction.recentDecisions.length + needsYou.pendingApprovals.length > 0) && (
        <section id="direction">
          <SectionHeader>Direction</SectionHeader>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Link
              href="/goals"
              className="rounded-lg border p-3 hover:bg-accent/50 transition-colors flex items-center gap-3"
            >
              <Target className="h-5 w-5 text-primary" />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-muted-foreground">Active goals</div>
                <div className="text-2xl font-semibold tracking-tight">{direction.activeGoals}</div>
              </div>
            </Link>
            <Link
              href="/tasks?status=open"
              className="rounded-lg border p-3 hover:bg-accent/50 transition-colors flex items-center gap-3"
            >
              <CheckSquare className="h-5 w-5 text-primary" />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-muted-foreground">Open tasks</div>
                <div className="text-2xl font-semibold tracking-tight">{direction.openTasks}</div>
              </div>
            </Link>
            <Link
              href="/tasks?status=blocked"
              className={`rounded-lg border p-3 hover:bg-accent/50 transition-colors flex items-center gap-3 ${direction.blockedTasks > 0 ? "border-destructive/40" : ""}`}
            >
              <AlertTriangle className={`h-5 w-5 ${direction.blockedTasks > 0 ? "text-destructive" : "text-muted-foreground/40"}`} />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-muted-foreground">Blocked tasks</div>
                <div className="text-2xl font-semibold tracking-tight">{direction.blockedTasks}</div>
              </div>
            </Link>
            <Link
              href="/approvals"
              className={`rounded-lg border p-3 hover:bg-accent/50 transition-colors flex items-center gap-3 ${needsYou.pendingApprovals.length > 0 ? "border-amber-500/40" : ""}`}
            >
              <Inbox className={`h-5 w-5 ${needsYou.pendingApprovals.length > 0 ? "text-amber-600" : "text-muted-foreground/40"}`} />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-muted-foreground">Approvals</div>
                <div className="text-2xl font-semibold tracking-tight">{needsYou.pendingApprovals.length}</div>
              </div>
            </Link>
          </div>
          {direction.recentDecisions.length > 0 && (
            <div className="space-y-2 mt-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Scale className="h-3.5 w-3.5" /> Recent decisions
              </div>
              {direction.recentDecisions.map(d => (
                <Link
                  key={d.id}
                  href={`/decisions/${d.id}`}
                  className="flex items-start gap-3 rounded-lg border p-3 hover:bg-accent/50 transition-colors"
                >
                  <Scale className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{d.title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{d.decision}</div>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">{timeAgo(d.created_at)}</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      {growth && <GrowthSection growth={growth} />}

      {agentHealth && <AgentHealthSection agentHealth={agentHealth} />}

      {github && github.configured && <GitHubSection github={github} />}

      {productReview && <ProductReviewCTA productReview={productReview} />}

      {weeklyReview && <WeeklyReviewSection weeklyReview={weeklyReview} />}

      {suggestions.length > 0 && (
        <section id="suggestions">
          <SectionHeader>Suggested next moves</SectionHeader>
          <div className="flex flex-wrap gap-2">
            {suggestions.map(s => (
              <Link
                key={s.id}
                href={s.href}
                className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-sm hover:bg-accent/50 transition-colors"
              >
                <span>{s.label}</span>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </section>
      )}

      <section id="needs-you">
        <SectionHeader count={needsYouCount > 0 ? needsYouCount : undefined}>Needs you</SectionHeader>
        {needsYouCount === 0 ? (
          <EmptyState icon={<Inbox className="h-6 w-6 text-muted-foreground/40" />}>
            Nothing needs you right now.
          </EmptyState>
        ) : (
          <div className="space-y-2">
            {needsYou.pendingApprovals.map(a => <ApprovalRow key={a.id} approval={a} />)}
            {needsYou.waitingWorkflowRuns.map(w => <WorkflowRow key={w.id} run={w} highlight />)}
            {needsYou.waitingRuns.map(r => <RunRow key={r.id} run={r} highlightStatus="waiting" />)}
            {needsYou.pendingRuns.map(r => <RunRow key={r.id} run={r} />)}
          </div>
        )}
      </section>

      <section id="running">
        <SectionHeader count={runningCount > 0 ? runningCount : undefined}>Running now</SectionHeader>
        {runningCount === 0 ? (
          <EmptyState icon={<Play className="h-6 w-6 text-muted-foreground/40" />}>
            No runs in flight.
          </EmptyState>
        ) : (
          <div className="space-y-2">
            {runningNow.runs.map(r => <RunRow key={r.id} run={r} />)}
            {runningNow.workflowRuns.map(w => <WorkflowRow key={w.id} run={w} />)}
          </div>
        )}
      </section>

      <section id="active-workflows">
        <SectionHeader count={activeWorkflows.length > 0 ? activeWorkflows.length : undefined}>
          Active workflows
        </SectionHeader>
        {activeWorkflows.length === 0 ? (
          <EmptyState icon={<WorkflowIcon className="h-6 w-6 text-muted-foreground/40" />}>
            No active workflow runs.
          </EmptyState>
        ) : (
          <div className="space-y-2">
            {activeWorkflows.map(w => <WorkflowRow key={w.id} run={w} />)}
          </div>
        )}
      </section>

      <section id="failed-or-stuck">
        <SectionHeader count={failedCount > 0 ? failedCount : undefined}>Failed or stuck</SectionHeader>
        {failedCount === 0 ? (
          <EmptyState icon={<ShieldAlert className="h-6 w-6 text-muted-foreground/40" />}>
            Nothing failed today.
          </EmptyState>
        ) : (
          <div className="space-y-2">
            {failedOrStuck.runs.map(r => <RunRow key={r.id} run={r} />)}
            {failedOrStuck.workflowRuns.map(w => <WorkflowRow key={w.id} run={w} />)}
          </div>
        )}
      </section>

      <section id="completed-today">
        <SectionHeader count={completedToday.done.length > 0 ? completedToday.done.length : undefined}>
          Completed today
        </SectionHeader>
        {completedToday.done.length === 0 && completedToday.skipped.length === 0 ? (
          <EmptyState icon={<CircleCheck className="h-6 w-6 text-muted-foreground/40" />}>
            Nothing has completed yet today.
          </EmptyState>
        ) : (
          <div className="space-y-3">
            {completedToday.done.length > 0 && (
              <div className="space-y-2">
                {completedToday.done.map(r => <RunRow key={r.id} run={r} />)}
              </div>
            )}
            {completedToday.skipped.length > 0 && (
              <details className="rounded-lg border p-3 text-sm text-muted-foreground">
                <summary className="cursor-pointer select-none font-medium">
                  Skipped ({completedToday.skipped.length})
                </summary>
                <div className="space-y-2 mt-3">
                  {completedToday.skipped.map(r => <RunRow key={r.id} run={r} muted />)}
                </div>
              </details>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function RunRow({
  run,
  muted,
  highlightStatus,
}: { run: Run; muted?: boolean; highlightStatus?: "waiting" }) {
  const ts = run.completed_at || run.updated_at;
  return (
    <Link
      href={`/runs/${run.id}`}
      className={`flex items-start gap-3 rounded-lg border p-3 hover:bg-accent/50 transition-colors ${muted ? "opacity-60" : ""}`}
    >
      <RunStatusIcon status={run.status} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{run.job_name}</span>
          {highlightStatus === "waiting" && (
            <Badge variant="secondary" className="text-[10px]">needs input</Badge>
          )}
          {(run.status === "failed" || run.status === "killed") && (
            <Badge variant="destructive" className="text-[10px]">{run.status}</Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground">
          {run.job_workflow_only && !run.agent_name ? (
            <><Terminal className="h-3 w-3" /><span>Workflow</span></>
          ) : run.job_workflow_command && run.agent_name ? (
            <><Bot className="h-3 w-3" /><Terminal className="h-3 w-3" /><span>{run.agent_name}</span></>
          ) : run.agent_name ? (
            <><Bot className="h-3 w-3" /><span>{run.agent_name}</span></>
          ) : null}
        </div>
      </div>
      <span className="text-xs text-muted-foreground shrink-0">{timeAgo(ts)}</span>
    </Link>
  );
}

function WorkflowRow({ run, highlight }: { run: WorkflowRun; highlight?: boolean }) {
  const isWaiting = run.status === "waiting_for_approval";
  const isFailed = run.status === "failed" || run.status === "rejected";
  const variant: "secondary" | "destructive" | "default" = isFailed
    ? "destructive"
    : isWaiting
      ? "secondary"
      : "default";
  return (
    <Link
      href={`/workflow-runs/${run.id}`}
      className={`flex items-start gap-3 rounded-lg border p-3 hover:bg-accent/50 transition-colors ${highlight ? "border-amber-500/40" : ""}`}
    >
      <WorkflowIcon className="h-4 w-4 mt-0.5 text-primary shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate">
            {run.workflow_name ?? "(unknown workflow)"}
          </span>
          <Badge variant={variant} className="text-[10px]">
            {run.status.replace(/_/g, " ")}
          </Badge>
        </div>
        {run.current_step_name && (
          <div className="text-xs text-muted-foreground mt-0.5 truncate">
            Step: {run.current_step_name}
          </div>
        )}
      </div>
      <span className="text-xs text-muted-foreground shrink-0">
        {timeAgo(run.started_at ?? run.created_at)}
      </span>
    </Link>
  );
}

function AgentHealthSection({ agentHealth }: { agentHealth: NonNullable<TodayResponse["agentHealth"]> }) {
  const { failing, lowUsefulness, highCost, waiting } = agentHealth;
  if (failing.length + lowUsefulness.length + highCost.length + waiting.length === 0) return null;
  return (
    <section id="agent-health">
      <SectionHeader>Agent health</SectionHeader>
      <div className="space-y-2">
        {failing.map(a => (
          <Link
            key={`f-${a.id}`}
            href={`/agents/${a.id}`}
            className="flex items-center gap-3 rounded-lg border border-destructive/40 p-3 hover:bg-accent/50 transition-colors"
          >
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium">{a.name}</span>
              <span className="text-xs text-muted-foreground ml-2">
                failure rate {Math.round(a.failureRate * 100)}% across {a.totalRuns} runs
              </span>
            </div>
            <Badge variant="destructive" className="text-[10px]">failing</Badge>
          </Link>
        ))}
        {lowUsefulness.map(a => (
          <Link
            key={`u-${a.id}`}
            href={`/agents/${a.id}`}
            className="flex items-center gap-3 rounded-lg border border-destructive/40 p-3 hover:bg-accent/50 transition-colors"
          >
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium">{a.name}</span>
              <span className="text-xs text-muted-foreground ml-2">
                usefulness {Math.round(a.usefulnessRatio * 100)}% ({a.ratingCount} ratings)
              </span>
            </div>
            <Badge variant="destructive" className="text-[10px]">low usefulness</Badge>
          </Link>
        ))}
        {highCost.map(a => (
          <Link
            key={`c-${a.id}`}
            href={`/agents/${a.id}`}
            className="flex items-center gap-3 rounded-lg border p-3 hover:bg-accent/50 transition-colors"
          >
            <Zap className="h-4 w-4 text-amber-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium">{a.name}</span>
              <span className="text-xs text-muted-foreground ml-2">
                ${a.totalCostUsd.toFixed(2)} total
              </span>
            </div>
            <Badge variant="secondary" className="text-[10px]">high cost</Badge>
          </Link>
        ))}
        {waiting.map(a => (
          <Link
            key={`w-${a.id}`}
            href={`/agents/${a.id}`}
            className="flex items-center gap-3 rounded-lg border p-3 hover:bg-accent/50 transition-colors"
          >
            <Inbox className="h-4 w-4 text-amber-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium">{a.name}</span>
              <span className="text-xs text-muted-foreground ml-2">
                {a.waitingRuns} waiting run{a.waitingRuns === 1 ? "" : "s"}
              </span>
            </div>
            <Badge variant="secondary" className="text-[10px]">waiting</Badge>
          </Link>
        ))}
      </div>
    </section>
  );
}

function GrowthSection({ growth }: { growth: NonNullable<TodayResponse["growth"]> }) {
  return (
    <section id="growth">
      <SectionHeader>Growth</SectionHeader>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Link href="/contacts?status=new" className="rounded-lg border p-3 hover:bg-accent/50 transition-colors flex items-center gap-3">
          <Users className="h-5 w-5 text-primary" />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-muted-foreground">New contacts</div>
            <div className="text-2xl font-semibold tracking-tight">{growth.newContacts}</div>
          </div>
        </Link>
        <Link href="/outreach?status=draft" className="rounded-lg border p-3 hover:bg-accent/50 transition-colors flex items-center gap-3">
          <Send className="h-5 w-5 text-primary" />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-muted-foreground">Drafts</div>
            <div className="text-2xl font-semibold tracking-tight">{growth.draftCount}</div>
          </div>
        </Link>
        <Link
          href="/outreach?status=pending_approval"
          className={`rounded-lg border p-3 hover:bg-accent/50 transition-colors flex items-center gap-3 ${growth.pendingApprovalCount > 0 ? "border-amber-500/40" : ""}`}
        >
          <ShieldAlert className={`h-5 w-5 ${growth.pendingApprovalCount > 0 ? "text-amber-600" : "text-muted-foreground/40"}`} />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-muted-foreground">Awaiting approval</div>
            <div className="text-2xl font-semibold tracking-tight">{growth.pendingApprovalCount}</div>
          </div>
        </Link>
        <Link href="/integrations/gmail" className="rounded-lg border p-3 hover:bg-accent/50 transition-colors flex items-center gap-3">
          <Building2 className={`h-5 w-5 ${growth.gmailConfigured ? "text-emerald-600" : "text-muted-foreground/40"}`} />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-muted-foreground">Gmail</div>
            <div className="text-sm font-medium tracking-tight">{growth.gmailConfigured ? "Connected" : "Not configured"}</div>
          </div>
        </Link>
      </div>
    </section>
  );
}

function GitHubSection({ github }: { github: NonNullable<TodayResponse["github"]> }) {
  const stale = github.staleDays !== null && github.staleDays > 7;
  const isoToTs = (iso: string) => {
    const t = Date.parse(iso);
    return isNaN(t) ? 0 : Math.floor(t / 1000);
  };
  return (
    <section id="github">
      <SectionHeader>GitHub</SectionHeader>
      <Link
        href="/integrations/github"
        className="block rounded-lg border p-3 hover:bg-accent/50 transition-colors"
      >
        <div className="flex items-center gap-2 flex-wrap">
          <GitBranch className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">{github.repo ?? "GitHub"}</span>
          {stale && <Badge variant="destructive" className="text-[10px]">Idle {github.staleDays}d</Badge>}
          <Badge variant="secondary" className="text-[10px] ml-auto">{github.openIssuesCount} issues</Badge>
          <Badge variant="secondary" className="text-[10px]">{github.openPRsCount} PRs</Badge>
        </div>
        {github.latestCommit && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1.5 truncate">
            <GitCommit className="h-3 w-3 shrink-0" />
            <span className="font-mono shrink-0">{github.latestCommit.sha.slice(0, 7)}</span>
            <span className="truncate">{github.latestCommit.message}</span>
            <span className="shrink-0 ml-auto">{timeAgo(isoToTs(github.latestCommit.date))}</span>
          </div>
        )}
      </Link>
    </section>
  );
}

function ProductReviewCTA({ productReview }: { productReview: { workflowId: string; activeRunId: string | null } }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  if (productReview.activeRunId) {
    // A run is already in flight — show a small status pill linking to it.
    return (
      <section id="product-review">
        <SectionHeader>Product Review Loop</SectionHeader>
        <Link
          href={`/workflow-runs/${productReview.activeRunId}`}
          className="flex items-center gap-3 rounded-lg border p-3 hover:bg-accent/50 transition-colors"
        >
          <WorkflowIcon className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium flex-1">Active product review</span>
          <span className="text-xs text-muted-foreground">View →</span>
        </Link>
      </section>
    );
  }

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch(`/api/workflows/${productReview.workflowId}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: { notes } }),
      });
      if (!res.ok) {
        alert((await res.json()).error || "Failed to start workflow.");
        return;
      }
      const out = await res.json();
      qc.invalidateQueries({ queryKey: ["today"] });
      setOpen(false);
      setNotes("");
      if (out.workflowRunId) router.push(`/workflow-runs/${out.workflowRunId}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="product-review">
      <SectionHeader>Product Review Loop</SectionHeader>
      <RoleGate
        action="mutateWorkflow"
        fallback={
          <p className="text-sm text-muted-foreground">No active product review. (Read-only access — ask an operator to start one.)</p>
        }
      >
        <Button size="sm" onClick={() => setOpen(true)}>
          <WorkflowIcon className="h-4 w-4 mr-1.5" /> Start Product Review
        </Button>
      </RoleGate>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Start Product Review</DialogTitle></DialogHeader>
          <form onSubmit={handleStart} className="space-y-4">
            <div className="space-y-2">
              <Label>Your notes (optional)</Label>
              <Textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={8}
                placeholder={"One item per line. Examples:\nFix login bug !!\nDECISION: Drop legacy /v1 API\nBLOCKED: Waiting on Stripe docs?"}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Lines starting with <code>DECISION:</code> become decisions. <code>BLOCKED:</code>, <code>DOING:</code>, <code>DONE:</code> override task status. <code>!!</code> marks high priority, trailing <code>?</code> marks low.
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
              <Button type="submit" disabled={busy}>{busy ? "Starting..." : "Start"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function WeeklyReviewSection({ weeklyReview }: { weeklyReview: NonNullable<TodayResponse["weeklyReview"]> }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  async function handleRun() {
    setBusy(true);
    try {
      const res = await fetch("/api/weekly-reviews/run", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(json.error || "Failed to run Weekly Review.");
        return;
      }
      qc.invalidateQueries({ queryKey: ["today"] });
      qc.invalidateQueries({ queryKey: ["weekly-reviews"] });
      if (json.doc?.id) router.push(`/docs/${json.doc.id}`);
    } finally {
      setBusy(false);
    }
  }

  if (weeklyReview.latest) {
    return (
      <section id="weekly-review">
        <SectionHeader>Weekly Review</SectionHeader>
        <Link
          href={`/docs/${weeklyReview.latest.id}`}
          className={`flex items-start gap-3 rounded-lg border p-3 hover:bg-accent/50 transition-colors ${weeklyReview.due ? "border-amber-500/40" : ""}`}
        >
          <CalendarCheck className="h-4 w-4 mt-0.5 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium truncate">{weeklyReview.latest.title}</span>
              {weeklyReview.due && <Badge variant="secondary" className="text-[10px]">due</Badge>}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {weeklyReview.latest.recommendations.length} recommendation{weeklyReview.latest.recommendations.length === 1 ? "" : "s"} - {timeAgo(weeklyReview.latest.created_at)}
            </div>
          </div>
          <span className="text-xs text-muted-foreground shrink-0">View →</span>
        </Link>
      </section>
    );
  }

  return (
    <section id="weekly-review">
      <SectionHeader>Weekly Review</SectionHeader>
      <div className="rounded-lg border border-dashed p-4 flex items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <CalendarCheck className="h-5 w-5 text-muted-foreground/40 shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-medium">No weekly review yet.</div>
            <p className="text-xs text-muted-foreground mt-0.5">Run one to create a durable Company OS review Doc.</p>
          </div>
        </div>
        <RoleGate action="mutateDoc">
          <Button size="sm" onClick={handleRun} disabled={busy}>
            {busy ? "Running..." : "Run Weekly Review"}
          </Button>
        </RoleGate>
      </div>
    </section>
  );
}

function ApprovalRow({ approval }: { approval: Approval }) {
  const risk = approval.risk_level;
  const riskClass =
    risk === "high" ? "destructive" : risk === "medium" ? "secondary" : "default";
  const href = "/approvals";
  return (
    <Link
      href={href}
      className="flex items-start gap-3 rounded-lg border border-amber-500/40 p-3 hover:bg-accent/50 transition-colors"
    >
      <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-600 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate">
            {approval.action_type.replace(/_/g, " ")}
          </span>
          <Badge variant={riskClass} className="text-[10px]">{risk} risk</Badge>
          <Badge variant="outline" className="text-[10px]">{approval.source_type.replace(/_/g, " ")}</Badge>
        </div>
        {approval.reason && (
          <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{approval.reason}</div>
        )}
      </div>
      <span className="text-xs text-muted-foreground shrink-0 flex items-center gap-1">
        <Zap className="h-3 w-3" />
        {timeAgo(approval.created_at)}
      </span>
    </Link>
  );
}
