"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Bot, Plus, Briefcase, Copy, Check, Terminal, ExternalLink, Loader2, CheckCircle, XCircle } from "lucide-react";
import { timeAgo } from "@/lib/time";
import { EmptyState } from "@/components/app/empty-state";

type Agent = {
  id: string;
  name: string;
  description: string | null;
  type: string;
  cli: string | null;
  model: string | null;
  job_count: number;
  waiting_count: number;
  pending_count: number;
  last_activity: number | null;
  last_polled_at: number | null;
};

type CliTool = {
  id: string;
  name: string;
  installed: boolean;
  version?: string;
};

const DEFAULT_MODELS: Record<string, string[]> = {
  claude: ["sonnet", "opus", "haiku"],
  codex: ["gpt-5.4", "o3", "gpt-4.1"],
  gemini: ["gemini-2.5-pro", "gemini-2.5-flash"],
};

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [newAgent, setNewAgent] = useState<{ id: string; name: string; apiKey: string; type: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Type selection
  const [agentType, setAgentType] = useState<"harbour" | "external" | null>(null);

  // CLI tool selection for harbour agents
  const [cliTools, setCliTools] = useState<CliTool[]>([]);
  const [loadingTools, setLoadingTools] = useState(false);
  const [selectedCli, setSelectedCli] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>("");

  async function loadAgents() {
    const res = await fetch("/api/agents");
    if (res.ok) setAgents(await res.json());
    setLoading(false);
  }

  useEffect(() => { loadAgents(); }, []);

  async function loadCliTools() {
    setLoadingTools(true);
    const res = await fetch("/api/system/cli-tools");
    if (res.ok) setCliTools(await res.json());
    setLoadingTools(false);
  }

  function handleTypeSelect(type: "harbour" | "external") {
    setAgentType(type);
    if (type === "harbour") {
      loadCliTools();
    }
  }

  function handleCliSelect(cliId: string) {
    setSelectedCli(cliId);
    const models = DEFAULT_MODELS[cliId] || [];
    setSelectedModel(models[0] || "");
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);

    const body: Record<string, string> = { name, description };
    if (agentType === "harbour") {
      body.type = "harbour";
      body.cli = selectedCli!;
      body.model = selectedModel;
    }

    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = await res.json();
      setNewAgent({ id: data.id, name: data.name, apiKey: data.apiKey, type: agentType || "external" });
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
    setAgentType(null);
    setSelectedCli(null);
    setSelectedModel("");
    setCliTools([]);
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground py-12 text-center">Loading...</div>;
  }

  const showRunnerBanner = agents.some(a => a.type === "harbour") && !agents.some(a => a.type === "harbour" && a.last_polled_at && (Date.now() / 1000 - a.last_polled_at) < 300);

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

      {showRunnerBanner && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm">
          <p className="font-medium text-amber-600">Runner not active</p>
          <p className="text-muted-foreground mt-0.5">
            You have Harbour agents but no runner polling. Run: <code className="text-xs bg-muted px-1 py-0.5 rounded">harbour agent install</code>
          </p>
        </div>
      )}

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
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{agent.name}</span>
                  {agent.type === "harbour" && agent.cli && (
                    <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{agent.cli}</span>
                  )}
                </div>
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
            <DialogTitle>
              {newAgent ? "Agent Created" : !agentType ? "New Agent" : agentType === "harbour" && !selectedCli ? "Select CLI Tool" : "New Agent"}
            </DialogTitle>
          </DialogHeader>

          {newAgent ? (
            // Success state
            newAgent.type === "harbour" ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  <strong>{newAgent.name}</strong> is ready. Create a job for this agent and it will start picking up work automatically.
                </p>
                <DialogFooter>
                  <Button onClick={handleCloseCreate}>Done</Button>
                </DialogFooter>
              </div>
            ) : (
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
            )
          ) : !agentType ? (
            // Type selection
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => handleTypeSelect("harbour")}
                className="flex flex-col items-center gap-2 rounded-lg border-2 border-transparent hover:border-primary p-6 text-center transition-colors bg-muted/50 hover:bg-muted"
              >
                <Terminal className="h-8 w-8 text-primary" />
                <div>
                  <p className="text-sm font-medium">Harbour Agent</p>
                  <p className="text-xs text-muted-foreground mt-1">Runs locally via CLI tool</p>
                </div>
              </button>
              <button
                onClick={() => handleTypeSelect("external")}
                className="flex flex-col items-center gap-2 rounded-lg border-2 border-transparent hover:border-primary p-6 text-center transition-colors bg-muted/50 hover:bg-muted"
              >
                <ExternalLink className="h-8 w-8 text-primary" />
                <div>
                  <p className="text-sm font-medium">External</p>
                  <p className="text-xs text-muted-foreground mt-1">Bring your own agent</p>
                </div>
              </button>
            </div>
          ) : agentType === "harbour" && !selectedCli ? (
            // CLI tool selection
            <div className="space-y-3">
              {loadingTools ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground">Detecting CLI tools...</span>
                </div>
              ) : (
                <div className="grid gap-2">
                  {cliTools.map(tool => (
                    <button
                      key={tool.id}
                      onClick={() => tool.installed && handleCliSelect(tool.id)}
                      disabled={!tool.installed}
                      className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                        tool.installed ? "hover:border-primary hover:bg-muted/50 cursor-pointer" : "opacity-50 cursor-not-allowed"
                      }`}
                    >
                      <div className="flex-1">
                        <p className="text-sm font-medium">{tool.name}</p>
                        {tool.installed && tool.version && (
                          <p className="text-xs text-muted-foreground">v{tool.version}</p>
                        )}
                      </div>
                      {tool.installed ? (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-muted-foreground" />
                      )}
                    </button>
                  ))}
                </div>
              )}
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setAgentType(null)}>Back</Button>
              </DialogFooter>
            </div>
          ) : (
            // Name + details form
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="agent-name">Name</Label>
                <Input id="agent-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Marketing Agent" autoFocus required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="agent-desc">Description</Label>
                <Textarea id="agent-desc" value={description} onChange={e => setDescription(e.target.value)} placeholder="What does this agent do?" rows={2} />
              </div>
              {agentType === "harbour" && selectedCli && (
                <div className="space-y-2">
                  <Label htmlFor="agent-model">Model</Label>
                  <select
                    id="agent-model"
                    value={selectedModel}
                    onChange={e => setSelectedModel(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {(DEFAULT_MODELS[selectedCli] || []).map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
              )}
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => {
                  if (agentType === "harbour") {
                    setSelectedCli(null);
                    setSelectedModel("");
                  } else {
                    setAgentType(null);
                  }
                }}>Back</Button>
                <Button type="submit" disabled={creating}>{creating ? "Creating..." : "Create"}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
