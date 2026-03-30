"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SectionHeader } from "@/components/app/section-header";
import { EmptyState } from "@/components/app/empty-state";
import { timeAgo } from "@/lib/time";
import { RunStatusIcon } from "@/components/app/run-status";

type Run = {
  id: string; status: string; job_name: string; agent_name: string;
  created_at: number; updated_at: number; completed_at: number | null;
};
type Agent = { id: string; name: string };
type Doc = { id: string; title: string };

function RunRow({ run }: { run: Run }) {
  return (
    <Link href={`/runs/${run.id}`} className="flex items-start gap-3 rounded-lg border p-3 hover:bg-accent/50 transition-colors">
      <RunStatusIcon status={run.status} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{run.job_name}</span>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground">
          <Bot className="h-3 w-3" />
          <span>{run.agent_name}</span>
        </div>
      </div>
      <span className="text-xs text-muted-foreground shrink-0">{timeAgo(run.completed_at || run.updated_at)}</span>
    </Link>
  );
}

export default function RunsPage() {
  const router = useRouter();
  const [scheduled, setScheduled] = useState<Run[]>([]);
  const [running, setRunning] = useState<Run[]>([]);
  const [waiting, setWaiting] = useState<Run[]>([]);
  const [pending, setPending] = useState<Run[]>([]);
  const [recent, setRecent] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);

  // New run dialog
  const [showCreate, setShowCreate] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [allDocs, setAllDocs] = useState<Doc[]>([]);
  const [agentId, setAgentId] = useState("");
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [whenType, setWhenType] = useState<"now" | "later">("now");
  const [scheduledTime, setScheduledTime] = useState("");

  function loadRuns() {
    fetch("/api/runs")
      .then(r => r.json())
      .then(data => {
        setScheduled(data.scheduled || []);
        setRunning(data.running || []);
        const all = data.waiting || [];
        setWaiting(all.filter((r: Run) => r.status === "waiting"));
        setPending(all.filter((r: Run) => r.status === "pending"));
        setRecent(data.recent || []);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadRuns(); }, []);

  async function openCreateDialog() {
    const [agentsRes, docsRes] = await Promise.all([
      fetch("/api/agents"),
      fetch("/api/docs"),
    ]);
    if (agentsRes.ok) {
      const data = await agentsRes.json();
      setAgents(data);
      if (data.length > 0 && !agentId) setAgentId(data[0].id);
    }
    if (docsRes.ok) setAllDocs(await docsRes.json());
    setShowCreate(true);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !agentId) return;

    const body: any = { agentId, name, instructions: instructions || undefined };
    if (selectedDocIds.length > 0) body.docIds = selectedDocIds;
    if (whenType === "later" && scheduledTime) {
      body.runAt = Math.floor(new Date(scheduledTime).getTime() / 1000);
    }

    await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    setShowCreate(false);
    setName("");
    setInstructions("");
    setSelectedDocIds([]);
    setWhenType("now");
    setScheduledTime("");
    loadRuns();
  }

  function toggleDoc(docId: string) {
    setSelectedDocIds(prev =>
      prev.includes(docId) ? prev.filter(id => id !== docId) : [...prev, docId]
    );
  }

  if (loading) return <div className="text-sm text-muted-foreground py-12 text-center">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Runs</h1>
          <p className="text-sm text-muted-foreground mt-1">All run activity across agents.</p>
        </div>
        <Button onClick={openCreateDialog} size="sm">
          <Plus className="h-4 w-4 mr-1.5" /> New Run
        </Button>
      </div>

      {running.length > 0 && (
        <section>
          <SectionHeader count={running.length}>Running</SectionHeader>
          <div className="space-y-2">
            {running.map(run => <RunRow key={run.id} run={run} />)}
          </div>
        </section>
      )}

      {scheduled.length > 0 && (
        <section>
          <SectionHeader count={scheduled.length}>Scheduled</SectionHeader>
          <div className="space-y-2">
            {scheduled.map(run => <RunRow key={run.id} run={run} />)}
          </div>
        </section>
      )}

      {waiting.length > 0 && (
        <section>
          <SectionHeader count={waiting.length}>Waiting</SectionHeader>
          <div className="space-y-2">
            {waiting.map(run => <RunRow key={run.id} run={run} />)}
          </div>
        </section>
      )}

      {pending.length > 0 && (
        <section>
          <SectionHeader count={pending.length}>Pending</SectionHeader>
          <div className="space-y-2">
            {pending.map(run => <RunRow key={run.id} run={run} />)}
          </div>
        </section>
      )}

      <section>
        <SectionHeader>Recent</SectionHeader>
        {recent.length === 0 ? (
          <EmptyState>No runs yet.</EmptyState>
        ) : (
          <div className="space-y-2">
            {recent.map(run => <RunRow key={run.id} run={run} />)}
          </div>
        )}
      </section>

      {/* New Run Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New Run</DialogTitle></DialogHeader>
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
              <Label>Title</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Research competitors" autoFocus required />
            </div>
            <div className="space-y-2">
              <Label>Instructions</Label>
              <Textarea value={instructions} onChange={e => setInstructions(e.target.value)} placeholder="What should the agent do?" rows={4} className="max-h-[30vh]" />
            </div>
            {allDocs.length > 0 && (
              <div className="space-y-2">
                <Label>Docs</Label>
                <div className="space-y-1 max-h-32 overflow-y-auto rounded-lg border p-2">
                  {allDocs.map(doc => (
                    <label key={doc.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-accent/50 rounded px-1 py-0.5">
                      <input
                        type="checkbox"
                        checked={selectedDocIds.includes(doc.id)}
                        onChange={() => toggleDoc(doc.id)}
                        className="rounded"
                      />
                      {doc.title}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label>When</Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setWhenType("now")}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${whenType === "now" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                >
                  Now
                </button>
                <button
                  type="button"
                  onClick={() => setWhenType("later")}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${whenType === "later" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                >
                  Schedule
                </button>
              </div>
              {whenType === "later" && (
                <Input
                  type="datetime-local"
                  value={scheduledTime}
                  onChange={e => setScheduledTime(e.target.value)}
                  required
                />
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button type="submit">Create Run</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
