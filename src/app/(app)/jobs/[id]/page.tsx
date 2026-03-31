"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SectionHeader } from "@/components/app/section-header";
import { EmptyState } from "@/components/app/empty-state";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BackLink } from "@/components/app/back-link";
import { SchedulePicker, parseSchedule, serializeSchedule, formatSchedule } from "@/components/app/schedule-picker";
import {
  Settings, Trash2, X, Plus,
  FileText, Database, Play, Pause, Bot, Calendar, RotateCcw, CalendarClock,
} from "lucide-react";
import { timeAgo, formatTimestamp } from "@/lib/time";
import { StatusDot } from "@/components/app/run-status";

type Job = {
  id: string; agent_id: string; agent_name: string; name: string; description: string | null;
  instructions: string | null; schedule: string; check_command: string | null; timeout_minutes: number;
  active: number; last_run_at: number | null; next_run_at: number | null;
  docs: { id: string; title: string }[];
  databases: { id: string; name: string; table_name: string }[];
};
type Run = { id: string; status: string; job_name: string; created_at: number; completed_at: number | null };

const INSTRUCTIONS_CHAR_LIMIT = 400;

function InstructionsBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const needsTruncation = text.length > INSTRUCTIONS_CHAR_LIMIT;
  const displayed = needsTruncation && !expanded ? text.slice(0, INSTRUCTIONS_CHAR_LIMIT).trimEnd() + "…" : text;

  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground uppercase tracking-wider">Instructions</p>
      <div className="prose prose-sm dark:prose-invert max-w-none rounded-lg border p-4 bg-card text-sm whitespace-pre-wrap break-words overflow-hidden">
        {displayed}
      </div>
      {needsTruncation && (
        <button onClick={() => setExpanded(!expanded)} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: job = null, isLoading: loading } = useQuery<Job | null>({
    queryKey: ["jobs", id],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${id}`);
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: 5000,
  });

  const { data: recentRunsData = [] } = useQuery({
    queryKey: ["runs", "recent"],
    queryFn: async () => {
      const res = await fetch("/api/runs?filter=recent");
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 5000,
  });

  const { data: waitingRunsData = [] } = useQuery({
    queryKey: ["runs", "waiting"],
    queryFn: async () => {
      const res = await fetch("/api/runs?filter=waiting");
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 5000,
  });

  const { data: allDocs = [] } = useQuery<{ id: string; title: string }[]>({
    queryKey: ["docs"],
    queryFn: async () => {
      const res = await fetch("/api/docs");
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 5000,
  });

  const recentArr = Array.isArray(recentRunsData) ? recentRunsData : [];
  const waitingArr = Array.isArray(waitingRunsData) ? waitingRunsData : [];
  const specificRuns = [
    ...waitingArr.filter((r: any) => r.job_id === id),
    ...recentArr.filter((r: any) => r.job_id === id),
  ];

  const [showEdit, setShowEdit] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editInstructions, setEditInstructions] = useState("");
  const [editSchedule, setEditSchedule] = useState(parseSchedule(null));
  const [editCheck, setEditCheck] = useState("");
  const [editTimeout, setEditTimeout] = useState(30);

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    await fetch(`/api/jobs/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editName,
        description: editDesc,
        instructions: editInstructions,
        schedule: serializeSchedule(editSchedule),
        checkCommand: editCheck || undefined,
        timeoutMinutes: editTimeout,
      }),
    });
    setShowEdit(false);
    queryClient.invalidateQueries({ queryKey: ["jobs", id] });
  }

  async function handleToggleActive() {
    if (!job) return;
    await fetch(`/api/jobs/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !job.active }),
    });
    queryClient.invalidateQueries({ queryKey: ["jobs", id] });
  }

  async function handleLinkDoc(docId: string) {
    await fetch(`/api/jobs/${id}/docs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ docId }),
    });
    queryClient.invalidateQueries({ queryKey: ["jobs", id] });
  }

  async function handleUnlinkDoc(docId: string) {
    await fetch(`/api/jobs/${id}/docs/${docId}`, { method: "DELETE" });
    queryClient.invalidateQueries({ queryKey: ["jobs", id] });
  }

  async function handleDelete() {
    if (!confirm(`Delete "${job?.name}"? All run history will be lost.`)) return;
    await fetch(`/api/jobs/${id}`, { method: "DELETE" });
    router.push(`/agents/${job?.agent_id}`);
  }

  if (loading) return <div className="text-sm text-muted-foreground py-12 text-center">Loading...</div>;
  if (!job) return <div className="text-sm text-muted-foreground py-12 text-center">Job not found.</div>;

  return (
    <div className="space-y-6">
      <BackLink href="/jobs" label="Jobs" />

      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{job.name}</h1>
            {!job.active && <Badge variant="secondary">Paused</Badge>}
          </div>
          {job.description && <p className="text-sm text-muted-foreground mt-0.5">{job.description}</p>}
        </div>
        <div className="flex gap-1.5">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleToggleActive} title={job.active ? "Pause" : "Resume"}>
            {job.active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => { if (job) { setEditName(job.name); setEditDesc(job.description || ""); setEditInstructions(job.instructions || ""); setEditSchedule(parseSchedule(job.schedule)); setEditCheck(job.check_command || ""); setEditTimeout(job.timeout_minutes ?? 30); } setShowEdit(true); }} title="Edit">
            <Settings className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-y-3 gap-x-4 rounded-lg border p-3">
        <div className="flex items-center gap-2 text-sm">
          <Bot className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <Link href={`/agents/${job.agent_id}`} className="text-muted-foreground hover:text-foreground transition-colors truncate">{job.agent_name}</Link>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-muted-foreground truncate">{formatSchedule(parseSchedule(job.schedule))}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <RotateCcw className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-muted-foreground truncate">{job.last_run_at ? timeAgo(job.last_run_at) : "No runs yet"}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <CalendarClock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-muted-foreground truncate">{formatTimestamp(job.next_run_at) || "—"}</span>
        </div>
      </div>

      {job.instructions && <InstructionsBlock text={job.instructions} />}

      {job.check_command && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Pre-run Check</p>
          <code className="block rounded-lg bg-muted px-3 py-2 text-xs font-mono">{job.check_command}</code>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Docs</p>
          {job.docs.length > 0 ? job.docs.map(d => (
            <div key={d.id} className="flex items-center gap-2 group">
              <Link href={`/docs/${d.id}`} className="flex items-center gap-2 text-sm hover:text-primary transition-colors flex-1 min-w-0">
                <FileText className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{d.title}</span>
              </Link>
              <button onClick={() => handleUnlinkDoc(d.id)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all" title="Remove">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )) : (
            <p className="text-sm text-muted-foreground">None</p>
          )}
          {(() => {
            const linkedIds = new Set(job.docs.map(d => d.id));
            const available = allDocs.filter(d => !linkedIds.has(d.id));
            if (available.length === 0) return null;
            return (
              <select
                className="w-full rounded-md border bg-transparent px-2 py-1.5 text-sm text-muted-foreground"
                value=""
                onChange={e => { if (e.target.value) handleLinkDoc(e.target.value); }}
              >
                <option value="">Add doc…</option>
                {available.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
              </select>
            );
          })()}
        </div>
        {job.databases.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Databases</p>
            {job.databases.map(d => (
              <Link key={d.id} href={`/databases/${d.id}`} className="flex items-center gap-2 text-sm font-mono hover:text-primary transition-colors">
                <Database className="h-3.5 w-3.5" /> {d.name}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Run History */}
      <div className="space-y-3">
        <SectionHeader>Run History</SectionHeader>
        {specificRuns.length === 0 ? (
          <EmptyState>No runs yet.</EmptyState>
        ) : (
          <div className="space-y-2">
            {specificRuns.map(run => (
              <Link key={run.id} href={`/runs/${run.id}`} className="flex items-center gap-3 rounded-lg border p-3 hover:bg-accent/50 transition-colors">
                <StatusDot status={run.status} />
                <span className="text-sm font-medium flex-1">{run.status}</span>
                <span className="text-xs text-muted-foreground">{timeAgo(run.completed_at || run.created_at)}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Edit Dialog */}
      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto overflow-x-hidden">
          <DialogHeader><DialogTitle>Edit Job</DialogTitle></DialogHeader>
          <form onSubmit={handleUpdate} className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={editName} onChange={e => setEditName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input value={editDesc} onChange={e => setEditDesc(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Instructions</Label>
              <Textarea value={editInstructions} onChange={e => setEditInstructions(e.target.value)} rows={4} className="max-h-[30vh] break-all" />
            </div>
            <div className="space-y-2">
              <Label>Schedule</Label>
              <SchedulePicker schedule={editSchedule} onChange={setEditSchedule} />
            </div>
            <div className="space-y-2">
              <Label>Pre-run Check</Label>
              <Input value={editCheck} onChange={e => setEditCheck(e.target.value)} className="font-mono text-xs" />
            </div>
            <div className="space-y-2">
              <Label>Timeout (minutes)</Label>
              <Input type="number" min={1} value={editTimeout} onChange={e => setEditTimeout(parseInt(e.target.value) || 30)} />
            </div>
            <DialogFooter>
              <Button type="button" variant="destructive" onClick={handleDelete} className="mr-auto"><Trash2 className="h-4 w-4 mr-1" /> Delete</Button>
              <Button type="button" variant="ghost" onClick={() => setShowEdit(false)}>Cancel</Button>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
