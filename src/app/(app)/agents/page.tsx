"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Bot, Plus, Briefcase, Copy, Check } from "lucide-react";
import { timeAgo } from "@/lib/time";
import { EmptyState } from "@/components/app/empty-state";

type Agent = {
  id: string;
  name: string;
  description: string | null;
  job_count: number;
  waiting_count: number;
  pending_count: number;
  last_activity: number | null;
  last_polled_at: number | null;
};

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [newAgent, setNewAgent] = useState<{ id: string; name: string; apiKey: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function loadAgents() {
    const res = await fetch("/api/agents");
    if (res.ok) setAgents(await res.json());
    setLoading(false);
  }

  useEffect(() => { loadAgents(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description }),
    });
    if (res.ok) {
      const data = await res.json();
      setNewAgent({ id: data.id, name: data.name, apiKey: data.apiKey });
      setName("");
      setDescription("");
      loadAgents();
    }
    setCreating(false);
  }

  function getInviteText() {
    if (!newAgent) return "";
    const base = typeof window !== "undefined" ? window.location.origin : "";
    return `You're being invited to Harbour, a control plane that manages your recurring jobs, shared docs, and data stores.

Save these credentials to your memory now:
- Agent ID: ${newAgent.id}
- API Key: ${newAgent.apiKey}
- Base URL: ${base}
- Poll endpoint: GET ${base}/api/agents/${newAgent.id}/next (Authorization: Bearer <key>)
- Guide: GET ${base}/api/guide

IMPORTANT: Read the full guide at the URL above before doing anything. Do NOT copy the guide contents into your memory — fetch it each time you need to reference it so you always have the latest version.

The guide covers everything: polling, scheduling, run lifecycle, docs, databases, and the full API. Follow it exactly.`;
  }

  function handleCopy() {
    navigator.clipboard.writeText(getInviteText());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleCloseCreate() {
    setShowCreate(false);
    setNewAgent(null);
    setCopied(false);
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground py-12 text-center">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
          <p className="text-sm text-muted-foreground mt-1">Your AI workforce.</p>
        </div>
        <Button onClick={() => setShowCreate(true)} size="sm">
          <Plus className="h-4 w-4 mr-1.5" /> New Agent
        </Button>
      </div>

      {agents.length === 0 ? (
        <EmptyState large icon={<Bot className="h-10 w-10 text-muted-foreground/40" />}>
          No agents yet. Create one to get started.
        </EmptyState>
      ) : (
        <div className="grid gap-2">
          {agents.map(agent => (
            <Link
              key={agent.id}
              href={`/agents/${agent.id}`}
              className="flex items-start gap-3 rounded-lg border p-3 hover:bg-accent/50 transition-colors"
            >
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${agent.waiting_count > 0 ? "bg-amber-500/10" : agent.pending_count > 0 ? "bg-blue-500/10" : "bg-primary/10"}`}>
                <Bot className={`h-4 w-4 ${agent.waiting_count > 0 ? "text-amber-500" : agent.pending_count > 0 ? "text-blue-500" : "text-primary"}`} />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">{agent.name}</span>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Briefcase className="h-3 w-3" /> {agent.job_count} jobs</span>
                  {agent.last_activity && <span>Active {timeAgo(agent.last_activity)}</span>}
                </div>
              </div>
              {agent.waiting_count > 0 && (
                <Badge className="text-[10px] bg-amber-500/10 text-amber-600 hover:bg-amber-500/10 shrink-0">{agent.waiting_count} waiting</Badge>
              )}
              {agent.pending_count > 0 && (
                <Badge className="text-[10px] bg-blue-500/10 text-blue-600 hover:bg-blue-500/10 shrink-0">{agent.pending_count} pending</Badge>
              )}
            </Link>
          ))}
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={handleCloseCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{newAgent ? "Agent Created" : "New Agent"}</DialogTitle>
          </DialogHeader>
          {newAgent ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Copy this invite and paste it into your agent. The API key won&apos;t be shown again.
              </p>
              <div className="rounded-md bg-muted px-3 py-2 text-xs font-mono whitespace-pre-wrap break-all select-all max-h-64 overflow-y-auto">{getInviteText()}</div>
              <DialogFooter>
                <Button variant="outline" onClick={handleCopy}>
                  {copied ? <><Check className="h-4 w-4 mr-1.5" /> Copied</> : <><Copy className="h-4 w-4 mr-1.5" /> Copy Invite</>}
                </Button>
                <Button onClick={handleCloseCreate}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="agent-name">Name</Label>
                <Input id="agent-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Marketing Agent" autoFocus required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="agent-desc">Description</Label>
                <Textarea id="agent-desc" value={description} onChange={e => setDescription(e.target.value)} placeholder="What does this agent do?" rows={2} />
              </div>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={handleCloseCreate}>Cancel</Button>
                <Button type="submit" disabled={creating}>{creating ? "Creating..." : "Create"}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
