"use client";

/**
 * Memory promotion — "Save as Task / Decision / Goal / Doc" affordance.
 *
 * Mounts on any activity-row in the dashboard (runs, workflow runs, etc.).
 * Opens a small dialog pre-filled from the provided `content` and posts to
 * the existing CRUD endpoints (/api/tasks, /api/decisions, /api/goals,
 * /api/docs). No new server routes are needed; RBAC is already enforced
 * by those endpoints.
 */

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button"; // used in the dialog
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Save,
  CheckSquare,
  Scale,
  Target,
  FileText,
  ChevronDown,
  ExternalLink,
} from "lucide-react";
import { RoleGate } from "@/components/app/role-gate";

type SaveAsKind = "task" | "decision" | "goal" | "doc";
type Priority = "low" | "medium" | "high";

export type SaveAsContext = {
  runId?: string;
  workflowRunId?: string;
  workflowName?: string;
};

type Goal = { id: string; title: string };

const KIND_META: Record<SaveAsKind, { label: string; icon: typeof Save; path: string }> = {
  task: { label: "Task", icon: CheckSquare, path: "/tasks" },
  decision: { label: "Decision", icon: Scale, path: "/decisions" },
  goal: { label: "Goal", icon: Target, path: "/goals" },
  doc: { label: "Doc", icon: FileText, path: "/docs" },
};

const TITLE_MAX = 100;

function defaultTitleFrom(content: string, override?: string): string {
  if (override) return override;
  const firstLine = (content || "").split(/\r?\n/).map(l => l.trim()).find(Boolean) || "";
  return firstLine.length > TITLE_MAX ? `${firstLine.slice(0, TITLE_MAX - 1)}…` : firstLine;
}

function sourceFooter(context: SaveAsContext | undefined): string {
  if (!context) return "";
  const parts: string[] = [];
  if (context.workflowRunId) {
    const label = context.workflowName ? `workflow: ${context.workflowName}` : "workflow run";
    parts.push(`Promoted from ${label} (/workflow-runs/${context.workflowRunId}).`);
  } else if (context.runId) {
    parts.push(`Promoted from run /runs/${context.runId}.`);
  }
  return parts.length ? `\n\n---\n${parts.join(" ")}` : "";
}

export function SaveAsMenu({
  content,
  defaultTitle,
  context,
}: {
  content: string;
  defaultTitle?: string;
  context?: SaveAsContext;
}) {
  const [openKind, setOpenKind] = useState<SaveAsKind | null>(null);
  if (!content || !content.trim()) return null;

  return (
    <RoleGate action="mutateTask">
      <DropdownMenu>
        <DropdownMenuTrigger className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
          <Save className="h-3.5 w-3.5" /> Save as <ChevronDown className="h-3 w-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {(["task", "decision", "goal", "doc"] as SaveAsKind[]).map(kind => {
            const meta = KIND_META[kind];
            return (
              <DropdownMenuItem key={kind} onSelect={() => setOpenKind(kind)}>
                <meta.icon className="h-3.5 w-3.5 mr-2" /> Save as {meta.label}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {openKind && (
        <SaveAsDialog
          kind={openKind}
          content={content}
          defaultTitle={defaultTitle}
          context={context}
          onClose={() => setOpenKind(null)}
        />
      )}
    </RoleGate>
  );
}

function SaveAsDialog({
  kind,
  content,
  defaultTitle,
  context,
  onClose,
}: {
  kind: SaveAsKind;
  content: string;
  defaultTitle?: string;
  context?: SaveAsContext;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const meta = KIND_META[kind];
  const initialTitle = defaultTitleFrom(content, defaultTitle);
  const initialBody = (content + sourceFooter(context)).trim();

  // Common fields
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ id: string; href: string } | null>(null);

  // Kind-specific fields
  const [priority, setPriority] = useState<Priority>("medium");
  const [goalId, setGoalId] = useState<string>("");
  const [rationale, setRationale] = useState("");
  const [consequences, setConsequences] = useState("");
  const [targetDate, setTargetDate] = useState("");

  const { data: goals = [] } = useQuery<Goal[]>({
    enabled: kind === "task",
    queryKey: ["goals", "for-save-as"],
    queryFn: async () => {
      const r = await fetch("/api/goals?status=active");
      if (!r.ok) return [];
      return r.json();
    },
  });

  async function handleSave() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      let res: Response;
      if (kind === "task") {
        res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.trim(),
            notes: body || null,
            priority,
            goal_id: goalId || null,
          }),
        });
      } else if (kind === "decision") {
        res = await fetch("/api/decisions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.trim(),
            decision: body.trim(),
            rationale: rationale || null,
            consequences: consequences || null,
          }),
        });
      } else if (kind === "goal") {
        res = await fetch("/api/goals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.trim(),
            notes: body || null,
            priority,
            target_date: targetDate
              ? Math.floor(new Date(targetDate + "T00:00:00").getTime() / 1000)
              : null,
          }),
        });
      } else {
        res = await fetch("/api/docs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.trim(),
            content: body,
          }),
        });
      }

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        alert(json.error || `Failed to save as ${meta.label}.`);
        return;
      }
      const saved = await res.json();
      setDone({ id: saved.id, href: `${meta.path}/${saved.id}` });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["decisions"] });
      qc.invalidateQueries({ queryKey: ["goals"] });
      qc.invalidateQueries({ queryKey: ["docs"] });
      qc.invalidateQueries({ queryKey: ["today"] });
    } finally {
      setSaving(false);
    }
  }

  const requiresDecisionBody = kind === "decision";
  const canSave = title.trim().length > 0 && (!requiresDecisionBody || body.trim().length > 0);

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <meta.icon className="h-4 w-4 text-primary" /> Save as {meta.label}
          </DialogTitle>
        </DialogHeader>

        {done ? (
          <div className="space-y-4 text-sm">
            <p className="text-emerald-700 dark:text-emerald-400">
              Saved as {meta.label}.
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={onClose}>Close</Button>
              <Link href={done.href} className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm hover:opacity-90">
                Open {meta.label} <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs">Title</Label>
              <Input value={title} onChange={e => setTitle(e.target.value)} autoFocus />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">
                {kind === "decision" ? "Decision" : kind === "doc" ? "Content (markdown)" : "Notes"}
              </Label>
              <Textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                rows={kind === "doc" ? 10 : 6}
                placeholder={kind === "decision" ? "What was decided?" : "Optional notes…"}
              />
            </div>

            {kind === "task" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Priority</Label>
                  <Select value={priority} onValueChange={v => setPriority(v as Priority)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">low</SelectItem>
                      <SelectItem value="medium">medium</SelectItem>
                      <SelectItem value="high">high</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Goal (optional)</Label>
                  <select
                    value={goalId}
                    onChange={e => setGoalId(e.target.value)}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  >
                    <option value="">— No goal —</option>
                    {goals.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
                  </select>
                </div>
              </div>
            )}

            {kind === "decision" && (
              <div className="grid grid-cols-1 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Rationale (optional)</Label>
                  <Textarea value={rationale} onChange={e => setRationale(e.target.value)} rows={2} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Consequences (optional)</Label>
                  <Textarea value={consequences} onChange={e => setConsequences(e.target.value)} rows={2} />
                </div>
              </div>
            )}

            {kind === "goal" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Priority</Label>
                  <Select value={priority} onValueChange={v => setPriority(v as Priority)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">low</SelectItem>
                      <SelectItem value="medium">medium</SelectItem>
                      <SelectItem value="high">high</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Target date (optional)</Label>
                  <Input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)} />
                </div>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving || !canSave}>
                <Save className="h-4 w-4 mr-1.5" />
                {saving ? "Saving..." : `Save as ${meta.label}`}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
