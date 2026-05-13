"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Workflow, Plus } from "lucide-react";
import { timeAgo } from "@/lib/time";
import { EmptyState } from "@/components/app/empty-state";
import { RoleGate } from "@/components/app/role-gate";

type WorkflowRow = {
  id: string;
  name: string;
  description: string | null;
  department: string | null;
  status: "draft" | "active" | "paused" | "archived";
  autonomy_level: "manual" | "supervised" | "autonomous";
  created_at: number;
  updated_at: number;
};

const STATUS_STYLES: Record<string, string> = {
  draft:    "bg-muted text-muted-foreground",
  active:   "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  paused:   "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  archived: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
};
const AUTONOMY_STYLES: Record<string, string> = {
  manual:      "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  supervised:  "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  autonomous:  "bg-rose-500/10 text-rose-700 dark:text-rose-400",
};

export default function WorkflowsPage() {
  const queryClient = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newDept, setNewDept] = useState("");
  const [newAutonomy, setNewAutonomy] = useState<"manual" | "supervised" | "autonomous">("supervised");
  const [filterDept, setFilterDept] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<string>("");

  const { data: workflows = [], isLoading } = useQuery<WorkflowRow[]>({
    queryKey: ["workflows"],
    queryFn: async () => {
      const res = await fetch("/api/workflows");
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 5000,
  });

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    const res = await fetch("/api/workflows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newName.trim(),
        description: newDesc.trim() || undefined,
        department: newDept.trim() || undefined,
        autonomyLevel: newAutonomy,
      }),
    });
    if (res.ok) {
      setShowNew(false);
      setNewName(""); setNewDesc(""); setNewDept(""); setNewAutonomy("supervised");
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
    } else {
      const err = await res.json().catch(() => ({ error: "Failed to create workflow" }));
      alert(err.error);
    }
  }

  const departments = Array.from(new Set(workflows.map(w => w.department).filter((d): d is string => !!d))).sort();
  const filtered = workflows.filter(w =>
    (!filterDept || w.department === filterDept) &&
    (!filterStatus || w.status === filterStatus),
  );

  if (isLoading) return <div className="text-sm text-muted-foreground py-12 text-center">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Workflows</h1>
          <p className="text-sm text-muted-foreground mt-1">Repeatable business processes — ordered steps with optional human approval gates.</p>
        </div>
        <RoleGate action="mutateWorkflow">
          <Button onClick={() => setShowNew(true)} size="sm">
            <Plus className="h-4 w-4 mr-1.5" /> New Workflow
          </Button>
        </RoleGate>
      </div>

      {workflows.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="text-xs px-2 py-1 rounded border bg-background">
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="archived">Archived</option>
          </select>
          {departments.length > 0 && (
            <select value={filterDept} onChange={e => setFilterDept(e.target.value)} className="text-xs px-2 py-1 rounded border bg-background">
              <option value="">All departments</option>
              {departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState>
          {workflows.length === 0
            ? "No workflows yet. Create one to model a department process (lead intake, support triage, bug fix, content production)."
            : "No workflows match the current filters."}
        </EmptyState>
      ) : (
        <div className="grid gap-2">
          {filtered.map(w => (
            <Link key={w.id} href={`/workflows/${w.id}`} className="flex items-start gap-3 rounded-lg border p-3 hover:bg-accent/50 transition-colors">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Workflow className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{w.name}</span>
                  {w.department && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{w.department}</span>}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_STYLES[w.status]}`}>{w.status}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${AUTONOMY_STYLES[w.autonomy_level]}`}>{w.autonomy_level}</span>
                </div>
                {w.description && <p className="text-xs text-muted-foreground mt-0.5 truncate">{w.description}</p>}
                <div className="text-xs text-muted-foreground mt-1">Updated {timeAgo(w.updated_at)}</div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Workflow</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="wf-name">Name</Label>
              <Input id="wf-name" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Lead Outreach" autoFocus />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wf-desc">Description (optional)</Label>
              <Textarea id="wf-desc" value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Research a new lead, draft outreach, then send" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wf-dept">Department (optional)</Label>
              <Input id="wf-dept" value={newDept} onChange={e => setNewDept(e.target.value)} placeholder="Sales / Support / Engineering / Product / Content / Finance" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wf-autonomy">Autonomy</Label>
              <select id="wf-autonomy" value={newAutonomy} onChange={e => setNewAutonomy(e.target.value as "manual" | "supervised" | "autonomous")}
                className="w-full text-sm px-3 py-2 rounded-md border bg-background">
                <option value="manual">Manual — approve every step</option>
                <option value="supervised">Supervised — approve risky steps</option>
                <option value="autonomous">Autonomous — only steps explicitly marked require approval</option>
              </select>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setShowNew(false)}>Cancel</Button>
              <Button type="submit">Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
