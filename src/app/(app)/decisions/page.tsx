"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Scale, Plus } from "lucide-react";
import { timeAgo } from "@/lib/time";
import { EmptyState } from "@/components/app/empty-state";
import { RoleGate } from "@/components/app/role-gate";

type Decision = {
  id: string;
  title: string;
  decision: string;
  rationale: string | null;
  consequences: string | null;
  created_at: number;
  updated_at: number;
};

export default function DecisionsPage() {
  const queryClient = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDecision, setNewDecision] = useState("");
  const [newRationale, setNewRationale] = useState("");

  const { data: decisions = [], isLoading: loading } = useQuery<Decision[]>({
    queryKey: ["decisions"],
    queryFn: async () => {
      const res = await fetch(`/api/decisions`);
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 5000,
  });

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim() || !newDecision.trim()) return;
    const res = await fetch("/api/decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: newTitle.trim(),
        decision: newDecision.trim(),
        rationale: newRationale || null,
      }),
    });
    if (res.ok) {
      setShowNew(false);
      setNewTitle("");
      setNewDecision("");
      setNewRationale("");
      queryClient.invalidateQueries({ queryKey: ["decisions"] });
    }
  }

  if (loading) return <div className="text-sm text-muted-foreground py-12 text-center">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Decisions</h1>
          <p className="text-sm text-muted-foreground mt-1">Durable record of what we chose and why.</p>
        </div>
        <RoleGate action="mutateDecision">
          <Button size="sm" onClick={() => setShowNew(true)}><Plus className="h-4 w-4 mr-1" /> New Decision</Button>
        </RoleGate>
      </div>

      {decisions.length === 0 ? (
        <EmptyState large icon={<Scale className="h-10 w-10 text-muted-foreground/40" />}>
          No decisions recorded yet.
        </EmptyState>
      ) : (
        <div className="space-y-2">
          {decisions.map(d => (
            <Link
              key={d.id}
              href={`/decisions/${d.id}`}
              className="flex items-start gap-3 rounded-lg border p-3 hover:bg-accent/50 transition-colors"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Scale className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{d.title}</div>
                <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{d.decision}</div>
              </div>
              <span className="text-xs text-muted-foreground shrink-0">{timeAgo(d.created_at)}</span>
            </Link>
          ))}
        </div>
      )}

      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Decision</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label>Title</Label>
              <Input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="e.g. Use SQLite by default" autoFocus required />
            </div>
            <div className="space-y-2">
              <Label>Decision</Label>
              <Textarea value={newDecision} onChange={e => setNewDecision(e.target.value)} rows={3} placeholder="What we chose to do." required />
            </div>
            <div className="space-y-2">
              <Label>Rationale (optional)</Label>
              <Textarea value={newRationale} onChange={e => setNewRationale(e.target.value)} rows={3} placeholder="Why we chose it." />
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
