"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Users2, Plus, Briefcase } from "lucide-react";
import { timeAgo } from "@/lib/time";
import { EmptyState } from "@/components/app/empty-state";
import { RoleGate } from "@/components/app/role-gate";

type Team = {
  id: string;
  name: string;
  description: string | null;
  member_count: number;
  job_count: number;
  created_at: number;
  updated_at: number;
};

export default function TeamsPage() {
  const queryClient = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const { data: teams = [], isLoading } = useQuery<Team[]>({
    queryKey: ["teams"],
    queryFn: async () => {
      const res = await fetch("/api/teams");
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 5000,
  });

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    const res = await fetch("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() || undefined }),
    });
    if (res.ok) {
      setShowNew(false);
      setNewName("");
      setNewDesc("");
      queryClient.invalidateQueries({ queryKey: ["teams"] });
    } else {
      const err = await res.json().catch(() => ({ error: "Failed to create team" }));
      alert(err.error);
    }
  }

  if (isLoading) return <div className="text-sm text-muted-foreground py-12 text-center">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Teams</h1>
          <p className="text-sm text-muted-foreground mt-1">Groups of agents with role-based job routing.</p>
        </div>
        <RoleGate action="mutateTeam">
          <Button onClick={() => setShowNew(true)} size="sm">
            <Plus className="h-4 w-4 mr-1.5" /> New Team
          </Button>
        </RoleGate>
      </div>

      {teams.length === 0 ? (
        <EmptyState>No teams yet. Teams group multiple agents and let them split work by role.</EmptyState>
      ) : (
        <div className="grid gap-2">
          {teams.map(t => (
            <Link key={t.id} href={`/teams/${t.id}`} className="flex items-start gap-3 rounded-lg border p-3 hover:bg-accent/50 transition-colors">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Users2 className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">{t.name}</span>
                {t.description && <p className="text-xs text-muted-foreground mt-0.5 truncate">{t.description}</p>}
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Users2 className="h-3 w-3" />{t.member_count} {t.member_count === 1 ? "agent" : "agents"}</span>
                  <span className="flex items-center gap-1"><Briefcase className="h-3 w-3" />{t.job_count} {t.job_count === 1 ? "job" : "jobs"}</span>
                  <span className="hidden sm:inline">Updated {timeAgo(t.updated_at)}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Team</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="team-name">Name</Label>
              <Input id="team-name" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Engineering" autoFocus />
            </div>
            <div className="space-y-2">
              <Label htmlFor="team-desc">Description (optional)</Label>
              <Textarea id="team-desc" value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Backend service team" />
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
