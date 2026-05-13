"use client";

/**
 * Company Dashboard — operator's overview of the Company-OS surface.
 *
 * Pure aggregation: every section talks to an endpoint that already exists
 * (workflow-runs list, runs list, autonomy approvals queue, security-status,
 * usage costs). No new visual primitives — sticks to the same
 * `rounded-lg border p-4 space-y-3` card pattern as Settings.
 */

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/app/empty-state";
import { AutonomyApprovalsPanel } from "@/components/app/autonomy-approvals-panel";
import { AlertTriangle, Workflow, ShieldAlert, ListChecks, DollarSign } from "lucide-react";
import { timeAgo } from "@/lib/time";

type WorkflowRunRow = {
  id: string;
  workflow_id: string;
  status: "running" | "waiting_for_approval" | "done" | "failed" | "rejected";
  current_step_id: string | null;
  started_at: number | null;
  created_at: number;
};

type WorkflowRow = { id: string; name: string };

type RunRow = {
  id: string;
  status: string;
  job_id: string;
  job_name: string | null;
  agent_id: string | null;
  agent_name: string | null;
  created_at: number;
  completed_at: number | null;
};

export default function DashboardPage() {
  return (
    <div className="max-w-3xl mx-auto py-8 px-4 space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          What needs your attention right now across workflows, approvals, runs, and cost.
        </p>
      </div>

      <PendingApprovalsCard />
      <ActiveWorkflowRunsCard />
      <FailedRunsCard />
      <CostAlertsCard />
      <SecurityCalloutsCard />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function CardShell({ title, description, icon, children }: {
  title: string; description?: string; icon: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border p-4 space-y-3">
      <div className="flex items-start gap-2">
        <div className="mt-0.5">{icon}</div>
        <div className="flex-1 min-w-0">
          <Label className="text-base font-medium">{title}</Label>
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          )}
        </div>
      </div>
      <div>{children}</div>
    </section>
  );
}

function PendingApprovalsCard() {
  return (
    <CardShell
      title="Pending approvals"
      description="Autonomy-policy decisions waiting on a human."
      icon={<ListChecks className="h-4 w-4 text-amber-600" />}
    >
      <AutonomyApprovalsPanel filter={{ status: "pending", limit: 20 }} />
    </CardShell>
  );
}

function ActiveWorkflowRunsCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-workflow-runs"],
    queryFn: async () => {
      const [runsRes, workflowsRes] = await Promise.all([
        fetch("/api/workflow-runs"),
        fetch("/api/workflows"),
      ]);
      if (!runsRes.ok) return { runs: [] as WorkflowRunRow[], workflows: [] as WorkflowRow[] };
      const runs = (await runsRes.json()) as WorkflowRunRow[];
      const workflowsJson = workflowsRes.ok ? await workflowsRes.json() : [];
      const workflows: WorkflowRow[] = Array.isArray(workflowsJson)
        ? workflowsJson
        : (workflowsJson.workflows ?? []);
      return { runs, workflows };
    },
    refetchInterval: 15_000,
  });

  const active = (data?.runs ?? []).filter(r =>
    r.status === "running" || r.status === "waiting_for_approval",
  );
  const nameById = new Map<string, string>((data?.workflows ?? []).map(w => [w.id, w.name]));

  return (
    <CardShell
      title="Active workflow runs"
      description="Workflows that are running or paused on a gate."
      icon={<Workflow className="h-4 w-4 text-primary" />}
    >
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : active.length === 0 ? (
        <EmptyState>No active workflow runs.</EmptyState>
      ) : (
        <div className="space-y-1">
          {active.map(r => (
            <Link
              key={r.id}
              href={`/workflow-runs/${r.id}`}
              className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent/50 transition-colors"
            >
              <span className="font-medium truncate flex-1">
                {nameById.get(r.workflow_id) ?? "(unknown workflow)"}
              </span>
              <Badge variant={r.status === "waiting_for_approval" ? "secondary" : "default"}>
                {r.status.replace(/_/g, " ")}
              </Badge>
              <span className="text-xs text-muted-foreground ml-2">
                {r.started_at ? timeAgo(r.started_at) : timeAgo(r.created_at)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </CardShell>
  );
}

function FailedRunsCard() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-failed-runs"],
    queryFn: async () => {
      const r = await fetch("/api/runs?filter=recent");
      if (!r.ok) return [] as RunRow[];
      return (await r.json()) as RunRow[];
    },
    refetchInterval: 30_000,
  });

  const failed = (data ?? []).filter(r =>
    r.status === "failed" || r.status === "killed",
  ).slice(0, 20);

  return (
    <CardShell
      title="Failed / killed runs (recent)"
      description="Runs that did not complete successfully."
      icon={<AlertTriangle className="h-4 w-4 text-rose-600" />}
    >
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : failed.length === 0 ? (
        <EmptyState>No failed or killed runs recently.</EmptyState>
      ) : (
        <div className="space-y-1">
          {failed.map(r => (
            <Link
              key={r.id}
              href={`/runs/${r.id}`}
              className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent/50 transition-colors"
            >
              <span className="font-medium truncate flex-1">{r.job_name ?? "(job)"}</span>
              <Badge variant={r.status === "killed" ? "secondary" : "destructive"}>{r.status}</Badge>
              <span className="text-xs text-muted-foreground ml-2">
                {timeAgo(r.completed_at ?? r.created_at)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </CardShell>
  );
}

function CostAlertsCard() {
  return (
    <CardShell
      title="Cost alerts"
      description="Autonomy cost-ceiling breaches awaiting review."
      icon={<DollarSign className="h-4 w-4 text-amber-600" />}
    >
      <AutonomyApprovalsPanel
        filter={{ status: "pending", source_type: "cost", limit: 10 }}
        emptyHint="No pending cost alerts."
      />
    </CardShell>
  );
}

type SecurityStatus = {
  unrestrictedAgents: { id: string; name: string }[];
  customModeIssues: { id: string; name: string }[];
  workspaceCollisions: { slug: string; agents: { id: string }[] }[];
  excessivePermissions: { id: string; name: string }[];
  apiAgentsWithoutStatus: { id: string; name: string }[];
};

function SecurityCalloutsCard() {
  const { data, isLoading } = useQuery<SecurityStatus | null>({
    queryKey: ["dashboard-security-status"],
    queryFn: async () => {
      const r = await fetch("/api/system/security-status");
      if (!r.ok) return null;
      return r.json();
    },
    refetchInterval: 60_000,
  });

  const issues: string[] = [];
  if (data) {
    if (data.unrestrictedAgents?.length) issues.push(`${data.unrestrictedAgents.length} unrestricted agent(s)`);
    if (data.customModeIssues?.length) issues.push(`${data.customModeIssues.length} agent(s) with invalid settings.json`);
    if (data.workspaceCollisions?.length) issues.push(`${data.workspaceCollisions.length} workspace collision(s)`);
    if (data.excessivePermissions?.length) issues.push(`${data.excessivePermissions.length} safe-mode agent(s) with excessive permissions`);
    if (data.apiAgentsWithoutStatus?.length) issues.push(`${data.apiAgentsWithoutStatus.length} API agent(s) without update_status permission`);
  }

  return (
    <CardShell
      title="Security callouts"
      description="Detected risks from the current configuration."
      icon={<ShieldAlert className="h-4 w-4 text-rose-600" />}
    >
      {isLoading || !data ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : issues.length === 0 ? (
        <EmptyState>No security issues detected.</EmptyState>
      ) : (
        <div className="space-y-2">
          <ul className="text-sm space-y-1">
            {issues.map(i => (
              <li key={i} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                {i}
              </li>
            ))}
          </ul>
          <Link href="/settings" className="text-xs text-primary underline">
            Review in Settings → Security
          </Link>
        </div>
      )}
    </CardShell>
  );
}
