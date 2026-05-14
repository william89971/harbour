"use client";

/**
 * Renders the editable "proposed tasks & decisions" UI for a workflow
 * run whose latest step activity contains a fenced ```json proposal``` block
 * matching `"source": "product-review-loop"`. The user reviews, edits,
 * deselects, and then clicks Save & Approve — which calls
 * POST /api/workflow-runs/{id}/save-proposal.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckSquare, Scale, Save, Sparkles } from "lucide-react";
import { RoleGate } from "@/components/app/role-gate";

type TaskStatus = "todo" | "doing" | "blocked" | "done" | "archived";
type TaskPriority = "low" | "medium" | "high";

type ProposedTask = {
  title: string;
  notes?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  goal_id?: string | null;
};

type ProposedDecision = {
  title: string;
  decision: string;
  rationale?: string;
  consequences?: string;
};

type Proposal = {
  tasks: ProposedTask[];
  decisions: ProposedDecision[];
  source: string;
};

type Activity = { content: string | null };
type RunDetail = { activity?: Activity[] };

type Goal = { id: string; title: string };

const TASK_STATUSES: TaskStatus[] = ["todo", "doing", "blocked", "done", "archived"];
const TASK_PRIORITIES: TaskPriority[] = ["low", "medium", "high"];

/** Pull the most recent fenced ```json proposal``` block out of a workflow
 *  run's underlying activity stream and parse it. Exported for tests. */
export function extractProposal(activity: Activity[] | undefined): Proposal | null {
  if (!activity) return null;
  const fence = /```json\s*proposal\s*\n([\s\S]*?)```/i;
  for (let i = activity.length - 1; i >= 0; i--) {
    const content = activity[i]?.content;
    if (!content) continue;
    const m = fence.exec(content);
    if (!m) continue;
    try {
      const parsed = JSON.parse(m[1]);
      if (parsed?.source === "product-review-loop" && Array.isArray(parsed?.tasks) && Array.isArray(parsed?.decisions)) {
        return parsed as Proposal;
      }
    } catch {
      /* keep scanning earlier entries */
    }
  }
  return null;
}

export function ProductReviewProposalPanel({
  workflowRunId,
  underlyingRunId,
}: {
  workflowRunId: string;
  underlyingRunId: string;
}) {
  const qc = useQueryClient();

  // Fetch the underlying run's activity stream where the proposal lives.
  const { data: run } = useQuery<RunDetail | null>({
    queryKey: ["run-with-activity", underlyingRunId],
    queryFn: async () => {
      const res = await fetch(`/api/runs/${underlyingRunId}`);
      if (!res.ok) return null;
      return res.json();
    },
  });

  const { data: goals = [] } = useQuery<Goal[]>({
    queryKey: ["goals", "for-proposal"],
    queryFn: async () => {
      const res = await fetch("/api/goals?status=active");
      if (!res.ok) return [];
      return res.json();
    },
  });

  const proposal = useMemo(() => extractProposal(run?.activity), [run]);

  if (!proposal) return null;

  return <ProposalForm key={underlyingRunId} workflowRunId={workflowRunId} initial={proposal} goals={goals} qc={qc} />;
}

function ProposalForm({
  workflowRunId,
  initial,
  goals,
  qc,
}: {
  workflowRunId: string;
  initial: Proposal;
  goals: Goal[];
  qc: ReturnType<typeof useQueryClient>;
}) {
  type TaskState = ProposedTask & { _selected: boolean };
  type DecisionState = ProposedDecision & { _selected: boolean };

  const [tasks, setTasks] = useState<TaskState[]>(() =>
    initial.tasks.map(t => ({
      _selected: true,
      title: t.title,
      notes: t.notes ?? "",
      status: (t.status as TaskStatus) ?? "todo",
      priority: (t.priority as TaskPriority) ?? "medium",
      goal_id: t.goal_id ?? null,
    })),
  );
  const [decisions, setDecisions] = useState<DecisionState[]>(() =>
    initial.decisions.map(d => ({
      _selected: true,
      title: d.title,
      decision: d.decision,
      rationale: d.rationale ?? "",
      consequences: d.consequences ?? "",
    })),
  );
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  // If the underlying run id changes (resume / re-draft), re-hydrate.
  useEffect(() => {
    setDone(null);
  }, [workflowRunId]);

  const selectedTaskCount = tasks.filter(t => t._selected).length;
  const selectedDecisionCount = decisions.filter(d => d._selected).length;

  async function handleSave() {
    setSaving(true);
    try {
      const payload = {
        tasks: tasks.filter(t => t._selected).map(({ _selected, ...rest }) => {
          void _selected;
          return rest;
        }),
        decisions: decisions.filter(d => d._selected).map(({ _selected, ...rest }) => {
          void _selected;
          return rest;
        }),
        approveWorkflowRun: true,
      };
      const res = await fetch(`/api/workflow-runs/${workflowRunId}/save-proposal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        alert(json.error ?? "Failed to save proposal");
        return;
      }
      const tn = json.created?.tasks?.length ?? 0;
      const dn = json.created?.decisions?.length ?? 0;
      setDone(`Saved ${tn} task${tn === 1 ? "" : "s"} and ${dn} decision${dn === 1 ? "" : "s"}.${json.approvalApplied ? " Workflow approved." : ""}`);
      qc.invalidateQueries({ queryKey: ["workflow-runs", workflowRunId] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["decisions"] });
      qc.invalidateQueries({ queryKey: ["goals"] });
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <section className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-2">
        <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
          <Sparkles className="h-4 w-4" />
          <span className="text-sm font-medium">{done}</span>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <p className="text-sm font-medium">Proposed tasks & decisions</p>
        <Badge variant="secondary" className="text-[10px]">{tasks.length} tasks, {decisions.length} decisions</Badge>
      </div>

      {tasks.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <CheckSquare className="h-3.5 w-3.5" /> Tasks
          </div>
          {tasks.map((t, i) => (
            <div key={i} className="rounded-md border bg-background p-3 space-y-2">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={t._selected}
                  onChange={e => setTasks(prev => prev.map((p, j) => j === i ? { ...p, _selected: e.target.checked } : p))}
                  className="mt-1"
                />
                <Input
                  value={t.title}
                  onChange={e => setTasks(prev => prev.map((p, j) => j === i ? { ...p, title: e.target.value } : p))}
                  disabled={!t._selected}
                />
              </div>
              <div className="grid grid-cols-3 gap-2 pl-6">
                <Select
                  value={t.status}
                  onValueChange={v => setTasks(prev => prev.map((p, j) => j === i ? { ...p, status: v as TaskStatus } : p))}
                  disabled={!t._selected}
                >
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TASK_STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select
                  value={t.priority}
                  onValueChange={v => setTasks(prev => prev.map((p, j) => j === i ? { ...p, priority: v as TaskPriority } : p))}
                  disabled={!t._selected}
                >
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TASK_PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
                <select
                  value={t.goal_id ?? ""}
                  onChange={e => setTasks(prev => prev.map((p, j) => j === i ? { ...p, goal_id: e.target.value || null } : p))}
                  disabled={!t._selected}
                  className="h-8 rounded-md border bg-background px-2 text-xs disabled:opacity-50"
                >
                  <option value="">— no goal —</option>
                  {goals.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}

      {decisions.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <Scale className="h-3.5 w-3.5" /> Decisions
          </div>
          {decisions.map((d, i) => (
            <div key={i} className="rounded-md border bg-background p-3 space-y-2">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={d._selected}
                  onChange={e => setDecisions(prev => prev.map((p, j) => j === i ? { ...p, _selected: e.target.checked } : p))}
                  className="mt-1"
                />
                <Input
                  value={d.title}
                  onChange={e => setDecisions(prev => prev.map((p, j) => j === i ? { ...p, title: e.target.value } : p))}
                  disabled={!d._selected}
                  placeholder="Decision title"
                />
              </div>
              <div className="pl-6 space-y-2">
                <div className="space-y-1">
                  <Label className="text-xs">Decision</Label>
                  <Textarea
                    value={d.decision}
                    onChange={e => setDecisions(prev => prev.map((p, j) => j === i ? { ...p, decision: e.target.value } : p))}
                    disabled={!d._selected}
                    rows={2}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Rationale (optional)</Label>
                  <Textarea
                    value={d.rationale ?? ""}
                    onChange={e => setDecisions(prev => prev.map((p, j) => j === i ? { ...p, rationale: e.target.value } : p))}
                    disabled={!d._selected}
                    rows={2}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <RoleGate action="mutateTask">
        <div className="flex items-center gap-2 pt-2">
          <Button onClick={handleSave} disabled={saving || (selectedTaskCount + selectedDecisionCount === 0)}>
            <Save className="h-4 w-4 mr-1.5" />
            {saving
              ? "Saving..."
              : `Save & approve (${selectedTaskCount} task${selectedTaskCount === 1 ? "" : "s"}, ${selectedDecisionCount} decision${selectedDecisionCount === 1 ? "" : "s"})`
            }
          </Button>
          <span className="text-xs text-muted-foreground">
            Uncheck items you don&apos;t want to save. Skip this panel and use the standard Approve / Reject buttons below to close without saving.
          </span>
        </div>
      </RoleGate>
    </section>
  );
}
