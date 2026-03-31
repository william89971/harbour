"use client";

import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { SchedulePicker, parseSchedule, serializeSchedule } from "@/components/app/schedule-picker";
import { CLI_CONFIG } from "@/lib/cli-config";
import { Pin } from "lucide-react";

type Agent = { id: string; name: string; type: string; cli: string | null; model: string | null; thinking: string | null };
type Doc = { id: string; title: string; pinned: number };

const SELECT_CLASS = "flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

export function CreateDialog({
  open,
  onOpenChange,
  defaultTab = "run",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTab?: "run" | "job";
}) {
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<"run" | "job">(defaultTab);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Shared fields
  const [agentId, setAgentId] = useState("");
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [model, setModel] = useState("");
  const [thinking, setThinking] = useState("");

  // Run-only fields
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [whenType, setWhenType] = useState<"now" | "later">("now");
  const [scheduledTime, setScheduledTime] = useState("");

  // Job-only fields
  const [description, setDescription] = useState("");
  const [schedule, setSchedule] = useState(parseSchedule(null));
  const [checkCommand, setCheckCommand] = useState("");

  // Reset tab to caller's default when dialog opens
  useEffect(() => {
    if (open) setTab(defaultTab);
  }, [open, defaultTab]);

  // Load agents + docs when dialog opens
  useEffect(() => {
    if (!open || loaded) return;
    (async () => {
      const [agentsRes, docsRes] = await Promise.all([
        fetch("/api/agents"),
        fetch("/api/docs"),
      ]);
      if (agentsRes.ok) {
        const data = await agentsRes.json();
        setAgents(data);
        if (data.length > 0 && !agentId) setAgentId(data[0].id);
      }
      if (docsRes.ok) setDocs(await docsRes.json());
      setLoaded(true);
    })();
  }, [open, loaded, agentId]);

  function reset() {
    setName("");
    setInstructions("");
    setModel("");
    setThinking("");
    setSelectedDocIds([]);
    setWhenType("now");
    setScheduledTime("");
    setDescription("");
    setSchedule(parseSchedule(null));
    setCheckCommand("");
    setLoaded(false);
  }

  function handleClose(value: boolean) {
    if (!value) reset();
    onOpenChange(value);
  }

  async function handleCreateRun(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !agentId) return;

    const body: Record<string, unknown> = {
      agentId,
      name,
      instructions: instructions || undefined,
    };
    if (selectedDocIds.length > 0) body.docIds = selectedDocIds;
    if (whenType === "later" && scheduledTime) {
      body.runAt = Math.floor(new Date(scheduledTime).getTime() / 1000);
    }

    await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    handleClose(false);
    queryClient.invalidateQueries({ queryKey: ["runs"] });
  }

  async function handleCreateJob(e: React.FormEvent) {
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
        model: model || undefined,
        thinking: thinking || undefined,
      }),
    });

    handleClose(false);
    queryClient.invalidateQueries({ queryKey: ["jobs"] });
  }

  function handleAgentChange(id: string) {
    setAgentId(id);
    setModel("");
    setThinking("");
  }

  const selectedAgent = agents.find(a => a.id === agentId);
  const cliConfig = selectedAgent?.type === "harbour" && selectedAgent.cli ? CLI_CONFIG[selectedAgent.cli] : null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{tab === "run" ? "New Run" : "New Job"}</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={v => setTab(v as "run" | "job")}>
          <TabsList className="w-full">
            <TabsTrigger value="run" className="flex-1">Run</TabsTrigger>
            <TabsTrigger value="job" className="flex-1">Job</TabsTrigger>
          </TabsList>

          {/* --- Run tab --- */}
          <TabsContent value="run">
            <form onSubmit={handleCreateRun} className="space-y-4 pt-2">
              {/* Shared: Agent */}
              <div className="space-y-2">
                <Label>Agent</Label>
                <select value={agentId} onChange={e => handleAgentChange(e.target.value)} className={SELECT_CLASS}>
                  {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>

              {/* Shared: Name */}
              <div className="space-y-2">
                <Label>Title</Label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Research competitors" required />
              </div>

              {/* Shared: Instructions */}
              <div className="space-y-2">
                <Label>Instructions</Label>
                <Textarea value={instructions} onChange={e => setInstructions(e.target.value)} placeholder="What should the agent do?" rows={3} className="max-h-[25vh]" />
              </div>

              {/* Run: Docs */}
              {docs.length > 0 && (
                <div className="space-y-2">
                  <Label>Docs</Label>
                  <div className="space-y-0.5 max-h-32 overflow-y-auto rounded-lg border p-2">
                    {docs.map(doc => (
                      <label key={doc.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-accent/50 rounded px-1.5 py-1">
                        <input
                          type="checkbox"
                          checked={selectedDocIds.includes(doc.id)}
                          onChange={() => setSelectedDocIds(prev =>
                            prev.includes(doc.id) ? prev.filter(id => id !== doc.id) : [...prev, doc.id]
                          )}
                          className="rounded"
                        />
                        <span className="flex-1 truncate">{doc.title}</span>
                        {doc.pinned === 1 && <Pin className="h-3 w-3 text-muted-foreground/50 shrink-0" />}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Shared: Model / Thinking (harbour agents) */}
              {cliConfig && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Model</Label>
                    <select value={model} onChange={e => setModel(e.target.value)} className={SELECT_CLASS}>
                      <option value="">Default{selectedAgent?.model ? ` (${selectedAgent.model})` : ""}</option>
                      {cliConfig.models.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label>{cliConfig.thinkingLabel}</Label>
                    <select value={thinking} onChange={e => setThinking(e.target.value)} className={SELECT_CLASS}>
                      <option value="">Default{selectedAgent?.thinking ? ` (${selectedAgent.thinking})` : ""}</option>
                      {cliConfig.thinkingOptions.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                </div>
              )}

              {/* Run: When */}
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
                  <Input type="datetime-local" value={scheduledTime} onChange={e => setScheduledTime(e.target.value)} required />
                )}
              </div>

              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => handleClose(false)}>Cancel</Button>
                <Button type="submit">Create Run</Button>
              </DialogFooter>
            </form>
          </TabsContent>

          {/* --- Job tab --- */}
          <TabsContent value="job">
            <form onSubmit={handleCreateJob} className="space-y-4 pt-2">
              {/* Shared: Agent */}
              <div className="space-y-2">
                <Label>Agent</Label>
                <select value={agentId} onChange={e => handleAgentChange(e.target.value)} className={SELECT_CLASS}>
                  {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>

              {/* Shared: Name */}
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Morning Tweet" required />
              </div>

              {/* Job: Description */}
              <div className="space-y-2">
                <Label>Description</Label>
                <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Brief description" />
              </div>

              {/* Shared: Instructions */}
              <div className="space-y-2">
                <Label>Instructions</Label>
                <Textarea value={instructions} onChange={e => setInstructions(e.target.value)} placeholder="What should the agent do?" rows={3} className="max-h-[25vh]" />
              </div>

              {/* Job: Schedule */}
              <div className="space-y-2">
                <Label>Schedule</Label>
                <SchedulePicker schedule={schedule} onChange={setSchedule} />
              </div>

              {/* Shared: Model / Thinking (harbour agents) */}
              {cliConfig && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Model</Label>
                    <select value={model} onChange={e => setModel(e.target.value)} className={SELECT_CLASS}>
                      <option value="">Default{selectedAgent?.model ? ` (${selectedAgent.model})` : ""}</option>
                      {cliConfig.models.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label>{cliConfig.thinkingLabel}</Label>
                    <select value={thinking} onChange={e => setThinking(e.target.value)} className={SELECT_CLASS}>
                      <option value="">Default{selectedAgent?.thinking ? ` (${selectedAgent.thinking})` : ""}</option>
                      {cliConfig.thinkingOptions.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                </div>
              )}

              {/* Job: Pre-run check */}
              <div className="space-y-2">
                <Label>Pre-run Check (optional)</Label>
                <Input value={checkCommand} onChange={e => setCheckCommand(e.target.value)} placeholder="e.g. python3 checks/new_videos.py" className="font-mono text-xs" />
                <p className="text-xs text-muted-foreground">Shell command run before the LLM. Exit 0 = proceed, non-zero = skip.</p>
              </div>

              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => handleClose(false)}>Cancel</Button>
                <Button type="submit">Create Job</Button>
              </DialogFooter>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
