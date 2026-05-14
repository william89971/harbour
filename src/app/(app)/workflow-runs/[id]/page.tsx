"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Workflow, CheckCircle2, XCircle, Clock, AlertTriangle, MessageSquare, RotateCcw } from "lucide-react";
import { timeAgo } from "@/lib/time";
import { BackLink } from "@/components/app/back-link";
import { EmptyState } from "@/components/app/empty-state";
import { SectionHeader } from "@/components/app/section-header";
import { RoleGate } from "@/components/app/role-gate";
import { AutonomyApprovalsPanel } from "@/components/app/autonomy-approvals-panel";
import { ProductReviewProposalPanel } from "@/components/app/product-review-proposal-panel";
import { GrowthOutreachProposalPanel } from "@/components/app/growth-outreach-proposal-panel";
import { SaveAsMenu } from "@/components/app/save-as-menu";

type StepRow = { id: string; step_order: number; name: string; instructions: string; approval_type: string };
type StepRun = {
  id: string;
  step_id: string;
  step_order: number;
  status: string;
  run_id: string | null;
  approval_user_id: string | null;
  approval_at: number | null;
  approval_comment: string | null;
  created_at: number;
  updated_at: number;
};
type Activity = {
  id: string;
  workflow_run_id: string;
  step_run_id: string | null;
  author_type: string;
  author_id: string | null;
  author_name: string | null;
  kind: "comment" | "approve" | "reject" | "request_changes" | "status" | "start" | "finish";
  content: string | null;
  created_at: number;
};
type WorkflowRunDetail = {
  id: string;
  workflow_id: string;
  status: "running" | "waiting_for_approval" | "done" | "failed" | "rejected";
  current_step_id: string | null;
  started_at: number | null;
  completed_at: number | null;
  created_at: number;
  workflow: { id: string; name: string; autonomy_level: string };
  steps: StepRow[];
  step_runs: StepRun[];
  activity: Activity[];
};

const STEP_STATUS_STYLES: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  waiting_approval_before: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  running: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  waiting_approval_after: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  done: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  failed: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
  skipped: "bg-muted text-muted-foreground",
  rejected: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
  needs_changes: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
};

const RUN_STATUS_STYLES: Record<string, string> = {
  running: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  waiting_for_approval: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  done: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  failed: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
  rejected: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
};

const ACTIVITY_ICONS: Record<Activity["kind"], typeof CheckCircle2> = {
  comment: MessageSquare,
  approve: CheckCircle2,
  reject: XCircle,
  request_changes: AlertTriangle,
  status: Clock,
  start: Clock,
  finish: CheckCircle2,
};

export default function WorkflowRunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: run, isLoading } = useQuery<WorkflowRunDetail | null>({
    queryKey: ["workflow-runs", id],
    queryFn: async () => {
      const res = await fetch(`/api/workflow-runs/${id}`);
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: 3000,
  });

  async function action(path: string, body: Record<string, unknown> = {}) {
    setBusy(true);
    const res = await fetch(`/api/workflow-runs/${id}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (res.ok) {
      setComment("");
      qc.invalidateQueries({ queryKey: ["workflow-runs", id] });
    } else if (res.status === 409) {
      // Race: someone else already resolved this step. Refresh silently —
      // the run-detail query will pull the latest state and the approval
      // panel will collapse.
      qc.invalidateQueries({ queryKey: ["workflow-runs", id] });
    } else {
      alert((await res.json()).error || "Action failed");
    }
  }

  if (isLoading) return <div className="text-sm text-muted-foreground py-12 text-center">Loading...</div>;
  if (!run) return <div className="text-sm text-muted-foreground py-12 text-center">Workflow run not found.</div>;

  const currentStepRun = run.step_runs.find(sr =>
    sr.status === "waiting_approval_before" || sr.status === "waiting_approval_after" || sr.status === "needs_changes",
  );
  const stepName = (stepId: string) => run.steps.find(s => s.id === stepId)?.name ?? "(step removed)";

  return (
    <div className="space-y-6">
      <BackLink href={`/workflows/${run.workflow_id}`} label={run.workflow.name} />

      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Workflow className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-semibold tracking-tight">{run.workflow.name}</h1>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${RUN_STATUS_STYLES[run.status]}`}>{run.status.replace(/_/g, " ")}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">autonomy: {run.workflow.autonomy_level}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">Started {run.started_at ? timeAgo(run.started_at) : timeAgo(run.created_at)}{run.completed_at && ` · Completed ${timeAgo(run.completed_at)}`}</p>
          </div>
        </div>
      </div>

      <section>
        <SectionHeader count={run.step_runs.length}>Steps</SectionHeader>
        {run.step_runs.length === 0 ? (
          <EmptyState>No step runs.</EmptyState>
        ) : (
          <div className="space-y-2">
            {run.step_runs.map((sr, i) => (
              <div key={sr.id} className="rounded-lg border p-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">#{i + 1}</span>
                  <span className="text-sm font-medium">{stepName(sr.step_id)}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${STEP_STATUS_STYLES[sr.status]}`}>{sr.status.replace(/_/g, " ")}</span>
                  {sr.run_id && (
                    <Link href={`/runs/${sr.run_id}`} className="ml-auto text-xs text-primary hover:underline">View run →</Link>
                  )}
                </div>
                {sr.approval_comment && (
                  <p className="text-xs text-muted-foreground mt-2 italic">{sr.approval_comment}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {run.status === "waiting_for_approval" && currentStepRun && currentStepRun.run_id && run.workflow.name === "Product Review Loop" && (
        <ProductReviewProposalPanel workflowRunId={run.id} underlyingRunId={currentStepRun.run_id} />
      )}

      {run.status === "waiting_for_approval" && currentStepRun && currentStepRun.run_id && run.workflow.name === "Growth Outreach Loop" && (
        <GrowthOutreachProposalPanel workflowRunId={run.id} underlyingRunId={currentStepRun.run_id} />
      )}

      {run.status === "waiting_for_approval" && currentStepRun && (
        <section className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
              Awaiting approval — step &ldquo;{stepName(currentStepRun.step_id)}&rdquo;
            </p>
          </div>
          <Textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="Optional comment for approval / reject. Required for request-changes."
            rows={3}
          />
          <RoleGate action="mutateWorkflow">
            <div className="flex gap-2 flex-wrap">
              {currentStepRun.status !== "needs_changes" && (
                <Button size="sm" disabled={busy} onClick={() => action("approve", { comment })}>
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Approve
                </Button>
              )}
              {currentStepRun.status !== "needs_changes" && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => {
                  if (!comment.trim()) { alert("Comment required for Request Changes."); return; }
                  action("request-changes", { comment });
                }}>
                  <AlertTriangle className="h-3.5 w-3.5 mr-1.5" /> Request Changes
                </Button>
              )}
              {currentStepRun.status === "needs_changes" && (
                <Button size="sm" disabled={busy} onClick={() => action("resume", {})}>
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Resume
                </Button>
              )}
              <Button size="sm" variant="destructive" disabled={busy} onClick={() => action("reject", { comment })}>
                <XCircle className="h-3.5 w-3.5 mr-1.5" /> Reject
              </Button>
            </div>
          </RoleGate>
          <div className="pt-2 border-t border-amber-500/30">
            <p className="text-xs uppercase tracking-wider text-amber-700 dark:text-amber-400 mb-2">
              Policy approvals
            </p>
            <AutonomyApprovalsPanel
              filter={{ source_type: "workflow_step", source_id: currentStepRun.id }}
              emptyHint="No policy-driven approvals for this step."
            />
          </div>
        </section>
      )}

      <section>
        <SectionHeader count={run.activity.length}>Activity</SectionHeader>
        {run.activity.length === 0 ? (
          <EmptyState>No activity yet.</EmptyState>
        ) : (
          <div className="space-y-2">
            {run.activity.map(a => {
              const Icon = ACTIVITY_ICONS[a.kind] ?? Clock;
              return (
                <div key={a.id} className="flex items-start gap-3 rounded-lg border p-3">
                  <Icon className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium">{a.author_name ?? a.author_type}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{a.kind.replace(/_/g, " ")}</span>
                      <span className="text-xs text-muted-foreground ml-auto">{timeAgo(a.created_at)}</span>
                      {a.content && (
                        <SaveAsMenu content={a.content} context={{ workflowRunId: run.id, workflowName: run.workflow.name }} />
                      )}
                    </div>
                    {a.content && <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{a.content}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-3 space-y-2">
          <Textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="Add a comment (does not change workflow state)"
            rows={2}
          />
          <Button size="sm" variant="outline" disabled={busy || !comment.trim()} onClick={() => action("comment", { content: comment })}>
            Add Comment
          </Button>
        </div>
      </section>
    </div>
  );
}
