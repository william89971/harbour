"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Workflow, Plus, Trash2, ArrowUp, ArrowDown, Play, Edit2, ShieldAlert } from "lucide-react";
import { timeAgo } from "@/lib/time";
import { BackLink } from "@/components/app/back-link";
import { EmptyState } from "@/components/app/empty-state";
import { SectionHeader } from "@/components/app/section-header";
import { RoleGate } from "@/components/app/role-gate";

type StepRow = {
  id: string;
  step_order: number;
  name: string;
  description: string | null;
  instructions: string;
  assigned_agent_id: string | null;
  assigned_team_id: string | null;
  preferred_role: string | null;
  role_fallback: "any" | "wait";
  requires_human_approval: number;
  approval_type: "none" | "before_step" | "after_step";
  risky: number;
  timeout_minutes: number;
};
type WorkflowDetail = {
  id: string;
  name: string;
  description: string | null;
  department: string | null;
  status: "draft" | "active" | "paused" | "archived";
  autonomy_level: "manual" | "supervised" | "autonomous";
  steps: StepRow[];
  recent_runs: { id: string; status: string; created_at: number }[];
};
type AgentLite = { id: string; name: string };
type TeamLite = { id: string; name: string };

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  active: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  paused: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  archived: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
};

export default function WorkflowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const { data: workflow, isLoading } = useQuery<WorkflowDetail | null>({
    queryKey: ["workflows", id],
    queryFn: async () => {
      const res = await fetch(`/api/workflows/${id}`);
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: 5000,
  });
  const { data: agents = [] } = useQuery<AgentLite[]>({
    queryKey: ["agents-lite"],
    queryFn: async () => {
      const res = await fetch("/api/agents");
      if (!res.ok) return [];
      const arr = await res.json();
      return arr.map((a: { id: string; name: string }) => ({ id: a.id, name: a.name }));
    },
  });
  const { data: teams = [] } = useQuery<TeamLite[]>({
    queryKey: ["teams-lite"],
    queryFn: async () => {
      const res = await fetch("/api/teams");
      if (!res.ok) return [];
      const arr = await res.json();
      return arr.map((t: { id: string; name: string }) => ({ id: t.id, name: t.name }));
    },
  });

  const [showAddStep, setShowAddStep] = useState(false);
  const [editingStep, setEditingStep] = useState<StepRow | null>(null);
  const [showEditMeta, setShowEditMeta] = useState(false);
  const [showStartDialog, setShowStartDialog] = useState(false);
  const [startInput, setStartInput] = useState("");

  async function saveMeta(patch: Partial<WorkflowDetail>) {
    const res = await fetch(`/api/workflows/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) qc.invalidateQueries({ queryKey: ["workflows", id] });
    else alert((await res.json()).error || "Failed to save");
  }
  async function deleteWorkflow() {
    if (!confirm("Delete this workflow? Active runs will continue but the definition is gone.")) return;
    const res = await fetch(`/api/workflows/${id}`, { method: "DELETE" });
    if (res.ok) router.push("/workflows");
  }
  async function deleteStep(stepId: string) {
    if (!confirm("Remove this step?")) return;
    const res = await fetch(`/api/workflows/${id}/steps/${stepId}`, { method: "DELETE" });
    if (res.ok) qc.invalidateQueries({ queryKey: ["workflows", id] });
  }
  async function moveStep(stepId: string, dir: -1 | 1) {
    if (!workflow) return;
    const idx = workflow.steps.findIndex(s => s.id === stepId);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= workflow.steps.length) return;
    const ordered = workflow.steps.map(s => s.id);
    [ordered[idx], ordered[swap]] = [ordered[swap], ordered[idx]];
    const res = await fetch(`/api/workflows/${id}/steps/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stepIds: ordered }),
    });
    if (res.ok) qc.invalidateQueries({ queryKey: ["workflows", id] });
  }
  async function startWorkflow() {
    let input: Record<string, unknown> | null = null;
    if (startInput.trim()) {
      try { input = JSON.parse(startInput); } catch {
        alert("Input must be valid JSON.");
        return;
      }
    }
    const res = await fetch(`/api/workflows/${id}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input }),
    });
    if (res.ok) {
      const data = await res.json();
      setShowStartDialog(false);
      setStartInput("");
      router.push(`/workflow-runs/${data.workflowRunId}`);
    } else {
      alert((await res.json()).error || "Failed to start");
    }
  }

  if (isLoading) return <div className="text-sm text-muted-foreground py-12 text-center">Loading...</div>;
  if (!workflow) return <div className="text-sm text-muted-foreground py-12 text-center">Workflow not found.</div>;

  return (
    <div className="space-y-6">
      <BackLink href="/workflows" label="Workflows" />

      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Workflow className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-semibold tracking-tight">{workflow.name}</h1>
              {workflow.department && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{workflow.department}</span>}
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_STYLES[workflow.status]}`}>{workflow.status}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-700 dark:text-violet-400">{workflow.autonomy_level}</span>
            </div>
            {workflow.description && <p className="text-sm text-muted-foreground mt-0.5">{workflow.description}</p>}
          </div>
        </div>
        <div className="flex gap-2">
          <RoleGate action="mutateWorkflow">
            <Button size="sm" onClick={() => setShowStartDialog(true)} disabled={workflow.steps.length === 0 || workflow.status === "archived"}>
              <Play className="h-3.5 w-3.5 mr-1.5" /> Start
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setShowEditMeta(true)} title="Settings">
              <Edit2 className="h-3.5 w-3.5" />
            </Button>
          </RoleGate>
        </div>
      </div>

      <section>
        <div className="flex items-center justify-between mb-2">
          <SectionHeader count={workflow.steps.length}>Steps</SectionHeader>
          <RoleGate action="mutateWorkflow">
            <Button variant="outline" size="sm" onClick={() => setShowAddStep(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Step
            </Button>
          </RoleGate>
        </div>
        {workflow.steps.length === 0 ? (
          <EmptyState>No steps yet. Add one to start designing the pipeline.</EmptyState>
        ) : (
          <div className="space-y-2">
            {workflow.steps.map((s, i) => (
              <div key={s.id} className="rounded-lg border p-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">#{i + 1}</span>
                  <span className="text-sm font-medium">{s.name}</span>
                  {!!s.risky && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-700 dark:text-rose-400 inline-flex items-center gap-1">
                      <ShieldAlert className="h-3 w-3" /> risky
                    </span>
                  )}
                  {s.approval_type !== "none" && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400">
                      approval {s.approval_type.replace("_", " ")}
                    </span>
                  )}
                  <div className="ml-auto flex gap-1">
                    <RoleGate action="mutateWorkflow">
                      <Button variant="ghost" size="icon" className="h-7 w-7" disabled={i === 0} onClick={() => moveStep(s.id, -1)}>
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" disabled={i === workflow.steps.length - 1} onClick={() => moveStep(s.id, 1)}>
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingStep(s)}>
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteStep(s.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </RoleGate>
                  </div>
                </div>
                {s.description && <p className="text-xs text-muted-foreground mt-1">{s.description}</p>}
                <pre className="text-xs text-muted-foreground mt-2 whitespace-pre-wrap font-mono bg-muted/30 rounded p-2 max-h-32 overflow-auto">{s.instructions}</pre>
                <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                  <span>{s.assigned_agent_id ? `Agent: ${agents.find(a => a.id === s.assigned_agent_id)?.name ?? s.assigned_agent_id}` : s.assigned_team_id ? `Team: ${teams.find(t => t.id === s.assigned_team_id)?.name ?? s.assigned_team_id}` : "Unassigned"}</span>
                  {s.preferred_role && <span>Role: {s.preferred_role}</span>}
                  <span>{s.timeout_minutes}m timeout</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {workflow.recent_runs.length > 0 && (
        <section>
          <SectionHeader>Recent runs</SectionHeader>
          <div className="space-y-2">
            {workflow.recent_runs.map(r => (
              <Link key={r.id} href={`/workflow-runs/${r.id}`} className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent/50 transition-colors">
                <span className="text-sm font-mono text-muted-foreground">{r.id.slice(0, 8)}</span>
                <span className="text-sm">{r.status}</span>
                <span className="text-xs text-muted-foreground">{timeAgo(r.created_at)}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <StepDialog
        open={showAddStep} onOpenChange={setShowAddStep}
        workflowId={id} agents={agents} teams={teams}
        onSaved={() => { setShowAddStep(false); qc.invalidateQueries({ queryKey: ["workflows", id] }); }}
      />
      {editingStep && (
        <StepDialog
          open={!!editingStep} onOpenChange={() => setEditingStep(null)}
          workflowId={id} agents={agents} teams={teams} step={editingStep}
          onSaved={() => { setEditingStep(null); qc.invalidateQueries({ queryKey: ["workflows", id] }); }}
        />
      )}

      <Dialog open={showEditMeta} onOpenChange={setShowEditMeta}>
        <DialogContent>
          <DialogHeader><DialogTitle>Workflow Settings</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input defaultValue={workflow.name} onBlur={e => saveMeta({ name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea defaultValue={workflow.description ?? ""} onBlur={e => saveMeta({ description: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Department</Label>
              <Input defaultValue={workflow.department ?? ""} onBlur={e => saveMeta({ department: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <select defaultValue={workflow.status} onChange={e => saveMeta({ status: e.target.value as WorkflowDetail["status"] })}
                className="w-full text-sm px-3 py-2 rounded-md border bg-background">
                <option value="draft">draft</option>
                <option value="active">active</option>
                <option value="paused">paused</option>
                <option value="archived">archived</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Autonomy</Label>
              <select defaultValue={workflow.autonomy_level} onChange={e => saveMeta({ autonomy_level: e.target.value as WorkflowDetail["autonomy_level"] })}
                className="w-full text-sm px-3 py-2 rounded-md border bg-background">
                <option value="manual">manual — approve every step</option>
                <option value="supervised">supervised — approve risky steps</option>
                <option value="autonomous">autonomous — only explicit approvals</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="destructive" onClick={deleteWorkflow} className="mr-auto">
              <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
            </Button>
            <Button onClick={() => setShowEditMeta(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showStartDialog} onOpenChange={setShowStartDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Start workflow</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Optional: pass a JSON object as input. Step instructions can reference values with <code className="text-xs bg-muted px-1 py-0.5 rounded">{`{{input.key}}`}</code>.
            </p>
            <Textarea
              value={startInput}
              onChange={e => setStartInput(e.target.value)}
              placeholder='{"leadName": "Acme Co", "budget": "50k"}'
              rows={4}
              className="font-mono text-xs"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowStartDialog(false)}>Cancel</Button>
            <Button onClick={startWorkflow}><Play className="h-3.5 w-3.5 mr-1.5" /> Start</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Step editor dialog (used for both add + edit). Auto-detects risky keywords.
// -----------------------------------------------------------------------------

function StepDialog({
  open, onOpenChange, workflowId, agents, teams, step, onSaved,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  workflowId: string;
  agents: AgentLite[];
  teams: TeamLite[];
  step?: StepRow;
  onSaved: () => void;
}) {
  const editing = !!step;
  const [name, setName] = useState(step?.name ?? "");
  const [desc, setDesc] = useState(step?.description ?? "");
  const [instructions, setInstructions] = useState(step?.instructions ?? "");
  const [assignment, setAssignment] = useState<"agent" | "team">(step?.assigned_team_id ? "team" : "agent");
  const [agentId, setAgentId] = useState(step?.assigned_agent_id ?? "");
  const [teamId, setTeamId] = useState(step?.assigned_team_id ?? "");
  const [role, setRole] = useState(step?.preferred_role ?? "");
  const [risky, setRisky] = useState(!!step?.risky);
  const [requiresApproval, setRequiresApproval] = useState(!!step?.requires_human_approval);
  const [approvalType, setApprovalType] = useState<"none" | "before_step" | "after_step">(step?.approval_type ?? "none");
  const [timeoutMinutes, setTimeoutMinutes] = useState(step?.timeout_minutes ?? 30);
  const [riskyTouched, setRiskyTouched] = useState(false);

  async function detectRisky(text: string) {
    if (riskyTouched) return; // Don't override user choice.
    // Trivial client-side mirror of the server keywords. The server still
    // re-runs the detection on create if risky is not set.
    const KW = [
      "send email", "send sms", "send message", "post to slack", "tweet",
      "spend", "charge", "pay", "wire", "refund",
      "delete", "drop table", "rm -rf", "truncate",
      "deploy", "git push", "merge to main", "production",
      "contact customer", "reach out",
    ];
    const lower = text.toLowerCase();
    const hit = KW.some(k => lower.includes(k));
    if (hit && !risky) setRisky(true);
  }

  async function handleSave() {
    if (!name.trim() || !instructions.trim()) {
      alert("Name and instructions are required.");
      return;
    }
    const body = {
      name: name.trim(),
      description: desc.trim() || null,
      instructions,
      assignedAgentId: assignment === "agent" ? (agentId || null) : null,
      assignedTeamId: assignment === "team" ? (teamId || null) : null,
      preferredRole: role.trim() || null,
      requiresHumanApproval: requiresApproval,
      approvalType,
      risky,
      timeoutMinutes,
    };
    const url = editing
      ? `/api/workflows/${workflowId}/steps/${step!.id}`
      : `/api/workflows/${workflowId}/steps`;
    const res = await fetch(url, {
      method: editing ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) onSaved();
    else alert((await res.json()).error || "Failed to save");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{editing ? "Edit Step" : "New Step"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Research lead" />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Short summary for the dashboard" />
          </div>
          <div className="space-y-2">
            <Label>Instructions (prompt the agent receives)</Label>
            <Textarea
              value={instructions}
              onChange={e => { setInstructions(e.target.value); detectRisky(e.target.value); }}
              placeholder='Research the lead "{{input.leadName}}" and post a summary.'
              rows={6}
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">Use {`{{input.key}}`} to interpolate workflow start inputs.</p>
          </div>
          <div className="space-y-2">
            <Label>Assignment</Label>
            <div className="flex gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={assignment === "agent"} onChange={() => setAssignment("agent")} />
                Single agent
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" checked={assignment === "team"} onChange={() => setAssignment("team")} />
                Team
              </label>
            </div>
            {assignment === "agent" ? (
              <select value={agentId} onChange={e => setAgentId(e.target.value)} className="w-full text-sm px-3 py-2 rounded-md border bg-background">
                <option value="">Pick an agent…</option>
                {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            ) : (
              <>
                <select value={teamId} onChange={e => setTeamId(e.target.value)} className="w-full text-sm px-3 py-2 rounded-md border bg-background">
                  <option value="">Pick a team…</option>
                  {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <Input value={role} onChange={e => setRole(e.target.value)} placeholder="Preferred role (optional, e.g. builder, reviewer)" />
              </>
            )}
          </div>
          <div className="space-y-2 rounded-md border p-3">
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={risky} onChange={e => { setRisky(e.target.checked); setRiskyTouched(true); }} className="mt-0.5" />
              <div className="text-sm">
                <p className="font-medium flex items-center gap-1.5"><ShieldAlert className="h-3.5 w-3.5 text-rose-500" /> Risky action</p>
                <p className="text-xs text-muted-foreground">Auto-checked when instructions mention sending email, money, deletion, deployment, or production. Risky steps pause for approval in supervised mode.</p>
              </div>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={requiresApproval} onChange={e => setRequiresApproval(e.target.checked)} className="mt-0.5" />
              <div className="text-sm">
                <p className="font-medium">Always require approval</p>
                <p className="text-xs text-muted-foreground">Force a human gate even in autonomous mode.</p>
              </div>
            </label>
            <div className="space-y-2">
              <Label>Approval timing</Label>
              <select value={approvalType} onChange={e => setApprovalType(e.target.value as "none" | "before_step" | "after_step")}
                className="w-full text-sm px-3 py-2 rounded-md border bg-background">
                <option value="none">No explicit gate (gating decided by autonomy + risky)</option>
                <option value="before_step">Pause before the step runs</option>
                <option value="after_step">Run, then pause for human review</option>
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Timeout (minutes)</Label>
            <Input type="number" min={1} max={1440} value={timeoutMinutes} onChange={e => setTimeoutMinutes(parseInt(e.target.value, 10) || 30)} className="w-24" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave}>{editing ? "Save" : "Add Step"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
