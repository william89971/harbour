"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SchedulePicker, parseSchedule, serializeSchedule, formatSchedule } from "@/components/app/schedule-picker";
import { Plus, Briefcase, Bot, Calendar } from "lucide-react";
import { timeAgo } from "@/lib/time";
import { EmptyState } from "@/components/app/empty-state";

type Job = {
  id: string; agent_id: string; agent_name: string; name: string;
  description: string | null; schedule: string;
  active: number; total_runs: number; skipped_runs: number; waiting_runs: number; pending_runs: number;
  last_run_at: number | null; check_command: string | null;
};

type Agent = { id: string; name: string };

export default function JobsPage() {
  const queryClient = useQueryClient();

  const { data: jobs = [], isLoading: jobsLoading } = useQuery<Job[]>({
    queryKey: ["jobs"],
    queryFn: async () => {
      const res = await fetch("/api/jobs");
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 5000,
  });

  const { data: agents = [], isLoading: agentsLoading } = useQuery<Agent[]>({
    queryKey: ["agents"],
    queryFn: async () => {
      const res = await fetch("/api/agents");
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 5000,
  });

  const loading = jobsLoading || agentsLoading;

  // Create dialog
  const [showCreate, setShowCreate] = useState(false);
  const [agentId, setAgentId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [schedule, setSchedule] = useState(parseSchedule(null));
  const [checkCommand, setCheckCommand] = useState("");

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !agentId) return;
    await fetch(`/api/agents/${agentId}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        description: description || undefined,
        instructions: instructions || undefined,
        schedule: serializeSchedule(schedule),
        checkCommand: checkCommand || undefined,
      }),
    });
    setShowCreate(false);
    setName("");
    setDescription("");
    setInstructions("");
    setSchedule(parseSchedule(null));
    setCheckCommand("");
    queryClient.invalidateQueries({ queryKey: ["jobs"] });
  }

  if (loading) return <div className="text-sm text-muted-foreground py-12 text-center">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
          <p className="text-sm text-muted-foreground mt-1">Recurring work across all agents.</p>
        </div>
        <Button onClick={() => { if (agents.length > 0 && !agentId) setAgentId(agents[0].id); setShowCreate(true); }} size="sm" disabled={agents.length === 0}>
          <Plus className="h-4 w-4 mr-1.5" /> New Job
        </Button>
      </div>

      {jobs.length === 0 ? (
        <EmptyState large icon={<Briefcase className="h-10 w-10 text-muted-foreground/40" />}>
          No jobs yet. Create one to get started.
        </EmptyState>
      ) : (
        <div className="grid gap-2">
          {jobs.map(job => (
            <Link key={job.id} href={`/jobs/${job.id}`} className="flex items-start gap-3 rounded-lg border p-3 hover:bg-accent/50 transition-colors">
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                !job.active ? "bg-muted" : job.waiting_runs > 0 ? "bg-amber-500/10" : job.pending_runs > 0 ? "bg-blue-500/10" : "bg-primary/10"
              }`}>
                <Briefcase className={`h-4 w-4 ${
                  !job.active ? "text-muted-foreground" : job.waiting_runs > 0 ? "text-amber-500" : job.pending_runs > 0 ? "text-blue-500" : "text-primary"
                }`} />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">{job.name}</span>
                <div className="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-3 mt-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Bot className="h-3 w-3" /> {job.agent_name}</span>
                  <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {formatSchedule(parseSchedule(job.schedule))}</span>
                  {(job.total_runs > 0 || job.skipped_runs > 0) && <span className="hidden sm:inline">{job.total_runs} runs{job.skipped_runs > 0 ? ` · ${job.skipped_runs} skipped` : ""}</span>}
                  {job.last_run_at && <span className="hidden sm:inline">Last run {timeAgo(job.last_run_at)}</span>}
                </div>
              </div>
              {(!job.active || job.waiting_runs > 0 || job.pending_runs > 0) && (
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {!job.active && <Badge variant="secondary" className="text-[10px]">Paused</Badge>}
                  {job.waiting_runs > 0 && <Badge className="text-[10px] bg-amber-500/10 text-amber-600 hover:bg-amber-500/10">{job.waiting_runs} waiting</Badge>}
                  {job.pending_runs > 0 && <Badge className="text-[10px] bg-blue-500/10 text-blue-600 hover:bg-blue-500/10">{job.pending_runs} pending</Badge>}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New Job</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label>Agent</Label>
              <select
                value={agentId}
                onChange={e => setAgentId(e.target.value)}
                className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
              >
                {agents.map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Morning Tweet" autoFocus required />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Brief description" />
            </div>
            <div className="space-y-2">
              <Label>Instructions</Label>
              <Textarea value={instructions} onChange={e => setInstructions(e.target.value)} placeholder="What should the agent do?" rows={4} className="max-h-[30vh]" />
            </div>
            <div className="space-y-2">
              <Label>Schedule</Label>
              <SchedulePicker schedule={schedule} onChange={setSchedule} />
            </div>
            <div className="space-y-2">
              <Label>Pre-run Check (optional)</Label>
              <Input value={checkCommand} onChange={e => setCheckCommand(e.target.value)} placeholder="e.g. python3 checks/new_videos.py" className="font-mono text-xs" />
              <p className="text-xs text-muted-foreground">Shell command run before the LLM. Exit 0 = proceed, non-zero = skip.</p>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button type="submit">Create Job</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
