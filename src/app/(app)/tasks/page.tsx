"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { CheckSquare, Plus, Target } from "lucide-react";
import { timeAgo } from "@/lib/time";
import { EmptyState } from "@/components/app/empty-state";
import { RoleGate } from "@/components/app/role-gate";

type TaskStatus = "todo" | "doing" | "blocked" | "done" | "archived";
type Task = {
  id: string;
  title: string;
  notes: string | null;
  status: TaskStatus;
  priority: "low" | "medium" | "high";
  owner_type: "user" | "agent" | "none";
  owner_id: string | null;
  goal_id: string | null;
  goal_title: string | null;
  due_date: number | null;
  created_at: number;
  updated_at: number;
};

type Goal = { id: string; title: string };

const statusBadgeVariant: Record<TaskStatus, "default" | "secondary" | "outline" | "destructive"> = {
  todo: "secondary",
  doing: "default",
  blocked: "destructive",
  done: "outline",
  archived: "outline",
};

const priorityBadgeVariant: Record<Task["priority"], "default" | "secondary" | "destructive"> = {
  high: "destructive",
  medium: "default",
  low: "secondary",
};

const STATUS_FILTERS: { id: string; label: string; statuses?: TaskStatus[] }[] = [
  { id: "all", label: "All" },
  { id: "open", label: "Open", statuses: ["todo", "doing"] },
  { id: "blocked", label: "Blocked", statuses: ["blocked"] },
  { id: "done", label: "Done", statuses: ["done"] },
];

export default function TasksPage() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const initialFilter = searchParams.get("status") === "blocked" ? "blocked"
    : searchParams.get("status") === "done" ? "done"
    : searchParams.get("status") === "open" ? "open"
    : "all";
  const [filterId, setFilterId] = useState<string>(initialFilter);
  const [showNew, setShowNew] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newGoalId, setNewGoalId] = useState<string>("");

  const currentFilter = useMemo(
    () => STATUS_FILTERS.find(f => f.id === filterId) ?? STATUS_FILTERS[0],
    [filterId],
  );
  const statusParam = currentFilter.statuses ? `?status=${currentFilter.statuses.join(",")}` : "";

  const { data: tasks = [], isLoading: loading } = useQuery<Task[]>({
    queryKey: ["tasks", currentFilter.id],
    queryFn: async () => {
      const res = await fetch(`/api/tasks${statusParam}`);
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 5000,
  });

  const { data: goals = [] } = useQuery<Goal[]>({
    queryKey: ["goals", "for-tasks"],
    queryFn: async () => {
      const res = await fetch(`/api/goals?status=active`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: newTitle.trim(),
        goal_id: newGoalId || null,
      }),
    });
    if (res.ok) {
      setShowNew(false);
      setNewTitle("");
      setNewGoalId("");
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    }
  }

  if (loading) return <div className="text-sm text-muted-foreground py-12 text-center">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
          <p className="text-sm text-muted-foreground mt-1">Outstanding work, with owners and status.</p>
        </div>
        <RoleGate action="mutateTask">
          <Button size="sm" onClick={() => setShowNew(true)}><Plus className="h-4 w-4 mr-1" /> New Task</Button>
        </RoleGate>
      </div>

      <div className="flex items-center gap-1 text-sm">
        {STATUS_FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => setFilterId(f.id)}
            className={`px-3 py-1 rounded-full transition-colors ${
              f.id === filterId
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {tasks.length === 0 ? (
        <EmptyState large icon={<CheckSquare className="h-10 w-10 text-muted-foreground/40" />}>
          No tasks{filterId === "all" ? " yet" : ` matching "${currentFilter.label}"`}.
        </EmptyState>
      ) : (
        <div className="space-y-2">
          {tasks.map(t => (
            <Link
              key={t.id}
              href={`/tasks/${t.id}`}
              className="flex items-start gap-3 rounded-lg border p-3 hover:bg-accent/50 transition-colors"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <CheckSquare className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium truncate">{t.title}</span>
                  <Badge variant={statusBadgeVariant[t.status]} className="text-[10px]">{t.status}</Badge>
                  <Badge variant={priorityBadgeVariant[t.priority]} className="text-[10px]">{t.priority}</Badge>
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                  {t.goal_title && (
                    <span className="inline-flex items-center gap-1">
                      <Target className="h-3 w-3" /> {t.goal_title}
                    </span>
                  )}
                  {t.owner_type !== "none" && t.owner_id && (
                    <span>Owner: {t.owner_type}:{t.owner_id}</span>
                  )}
                </div>
              </div>
              <span className="text-xs text-muted-foreground shrink-0">{timeAgo(t.updated_at)}</span>
            </Link>
          ))}
        </div>
      )}

      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Task</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="e.g. Write Q2 OKR draft" autoFocus required />
            </div>
            <div className="space-y-2">
              <Label>Goal (optional)</Label>
              <select
                value={newGoalId}
                onChange={e => setNewGoalId(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">— No goal —</option>
                {goals.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
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
