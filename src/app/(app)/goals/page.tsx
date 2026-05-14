"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Target, Plus } from "lucide-react";
import { timeAgo } from "@/lib/time";
import { EmptyState } from "@/components/app/empty-state";
import { RoleGate } from "@/components/app/role-gate";

type Goal = {
  id: string;
  title: string;
  notes: string | null;
  status: "active" | "paused" | "completed" | "archived";
  priority: "low" | "medium" | "high";
  target_date: number | null;
  created_at: number;
  updated_at: number;
};

const statusBadgeVariant: Record<Goal["status"], "default" | "secondary" | "outline"> = {
  active: "default",
  paused: "secondary",
  completed: "outline",
  archived: "outline",
};

const priorityBadgeVariant: Record<Goal["priority"], "default" | "secondary" | "destructive"> = {
  high: "destructive",
  medium: "default",
  low: "secondary",
};

export default function GoalsPage() {
  const queryClient = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newNotes, setNewNotes] = useState("");

  const { data: goals = [], isLoading: loading } = useQuery<Goal[]>({
    queryKey: ["goals"],
    queryFn: async () => {
      const res = await fetch(`/api/goals`);
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 5000,
  });

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    const res = await fetch("/api/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle.trim(), notes: newNotes || null }),
    });
    if (res.ok) {
      setShowNew(false);
      setNewTitle("");
      setNewNotes("");
      queryClient.invalidateQueries({ queryKey: ["goals"] });
    }
  }

  if (loading) return <div className="text-sm text-muted-foreground py-12 text-center">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Goals</h1>
          <p className="text-sm text-muted-foreground mt-1">Durable direction — what the company is trying to achieve.</p>
        </div>
        <RoleGate action="mutateGoal">
          <Button size="sm" onClick={() => setShowNew(true)}><Plus className="h-4 w-4 mr-1" /> New Goal</Button>
        </RoleGate>
      </div>

      {goals.length === 0 ? (
        <EmptyState large icon={<Target className="h-10 w-10 text-muted-foreground/40" />}>
          No goals yet.
        </EmptyState>
      ) : (
        <div className="space-y-2">
          {goals.map(g => (
            <Link
              key={g.id}
              href={`/goals/${g.id}`}
              className="flex items-start gap-3 rounded-lg border p-3 hover:bg-accent/50 transition-colors"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Target className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium truncate">{g.title}</span>
                  <Badge variant={statusBadgeVariant[g.status]} className="text-[10px]">{g.status}</Badge>
                  <Badge variant={priorityBadgeVariant[g.priority]} className="text-[10px]">{g.priority}</Badge>
                </div>
                {g.notes && <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{g.notes}</div>}
              </div>
              <span className="text-xs text-muted-foreground shrink-0">{timeAgo(g.updated_at)}</span>
            </Link>
          ))}
        </div>
      )}

      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Goal</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="e.g. Reach 100 paying customers" autoFocus required />
            </div>
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Input value={newNotes} onChange={e => setNewNotes(e.target.value)} placeholder="Context, success criteria, etc." />
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
