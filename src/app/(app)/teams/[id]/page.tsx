"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BackLink } from "@/components/app/back-link";
import { SectionHeader } from "@/components/app/section-header";
import { EmptyState } from "@/components/app/empty-state";
import { Users2, Settings, Trash2, Bot, Plus, X } from "lucide-react";

type Role = "researcher" | "builder" | "reviewer" | "debugger" | "custom";
const ROLES: Role[] = ["researcher", "builder", "reviewer", "debugger", "custom"];

const ROLE_STYLES: Record<Role, string> = {
  researcher: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  builder: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  reviewer: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  debugger: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  custom: "bg-muted text-muted-foreground",
};

type Team = {
  id: string;
  name: string;
  description: string | null;
  created_at: number;
  updated_at: number;
  members: { agent_id: string; agent_name: string; role: Role; custom_role: string | null; created_at: number }[];
};

type Agent = { id: string; name: string; type: string; cli: string | null };

function RoleBadge({ role, customRole }: { role: Role; customRole: string | null }) {
  const label = role === "custom" ? (customRole || "Custom") : role.charAt(0).toUpperCase() + role.slice(1);
  return <span className={`text-[10px] px-1.5 py-0.5 rounded ${ROLE_STYLES[role]}`}>{label}</span>;
}

export default function TeamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [showSettings, setShowSettings] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [showAddMember, setShowAddMember] = useState(false);
  const [addAgentId, setAddAgentId] = useState("");
  const [addRole, setAddRole] = useState<Role>("custom");
  const [addCustomRole, setAddCustomRole] = useState("");

  const { data: team } = useQuery<Team>({
    queryKey: ["teams", id],
    queryFn: async () => {
      const res = await fetch(`/api/teams/${id}`);
      if (!res.ok) throw new Error("Team not found");
      return res.json();
    },
    refetchInterval: 5000,
  });

  const { data: allAgents = [] } = useQuery<Agent[]>({
    queryKey: ["agents"],
    queryFn: async () => {
      const res = await fetch("/api/agents");
      if (!res.ok) return [];
      return res.json();
    },
  });

  if (!team) return <div className="text-sm text-muted-foreground py-12 text-center">Loading...</div>;

  const memberIds = new Set(team.members.map(m => m.agent_id));
  const availableAgents = allAgents.filter(a => !memberIds.has(a.id));

  async function handleSaveSettings() {
    const res = await fetch(`/api/teams/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName, description: editDesc }),
    });
    if (!res.ok) { alert("Failed to update team"); return; }
    setShowSettings(false);
    queryClient.invalidateQueries({ queryKey: ["teams"] });
  }

  async function handleDelete() {
    if (!confirm(`Delete team "${team!.name}"? Jobs assigned to this team will be unassigned but not deleted.`)) return;
    const res = await fetch(`/api/teams/${id}`, { method: "DELETE" });
    if (!res.ok) { alert("Failed to delete team"); return; }
    queryClient.invalidateQueries({ queryKey: ["teams"] });
    router.push("/teams");
  }

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault();
    if (!addAgentId) return;
    if (addRole === "custom" && !addCustomRole.trim()) { alert("Custom role requires a label"); return; }
    const res = await fetch(`/api/teams/${id}/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: addAgentId, role: addRole, customRole: addRole === "custom" ? addCustomRole.trim() : undefined }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to add member" }));
      alert(err.error);
      return;
    }
    setShowAddMember(false);
    setAddAgentId("");
    setAddRole("custom");
    setAddCustomRole("");
    queryClient.invalidateQueries({ queryKey: ["teams", id] });
  }

  async function handleRemoveMember(agentId: string) {
    if (!confirm("Remove this agent from the team?")) return;
    const res = await fetch(`/api/teams/${id}/agents/${agentId}`, { method: "DELETE" });
    if (!res.ok) { alert("Failed to remove member"); return; }
    queryClient.invalidateQueries({ queryKey: ["teams", id] });
  }

  async function handleChangeRole(agentId: string, newRole: Role, customRole?: string) {
    const res = await fetch(`/api/teams/${id}/agents/${agentId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: newRole, customRole }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Failed to update role" }));
      alert(err.error);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["teams", id] });
  }

  return (
    <div className="space-y-6">
      <BackLink href="/teams" label="Teams" />

      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Users2 className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{team.name}</h1>
            {team.description && <p className="text-sm text-muted-foreground mt-1">{team.description}</p>}
          </div>
        </div>
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => { setEditName(team.name); setEditDesc(team.description || ""); setShowSettings(true); }} title="Settings">
          <Settings className="h-3.5 w-3.5" />
        </Button>
      </div>

      <section>
        <div className="flex items-center justify-between mb-2">
          <SectionHeader count={team.members.length}>Members</SectionHeader>
          <Button variant="outline" size="sm" onClick={() => setShowAddMember(true)} disabled={availableAgents.length === 0}>
            <Plus className="h-4 w-4 mr-1.5" /> Add Agent
          </Button>
        </div>
        {team.members.length === 0 ? (
          <EmptyState>No agents in this team yet.</EmptyState>
        ) : (
          <div className="rounded-lg border divide-y">
            {team.members.map(m => (
              <div key={m.agent_id} className="flex items-center gap-3 p-3 text-sm">
                <Bot className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <Link href={`/agents/${m.agent_id}`} className="flex-1 truncate hover:text-foreground transition-colors">{m.agent_name}</Link>
                <select
                  value={m.role}
                  onChange={e => {
                    const newRole = e.target.value as Role;
                    if (newRole === "custom") {
                      const label = prompt("Custom role label:", m.custom_role || "");
                      if (!label) return;
                      handleChangeRole(m.agent_id, newRole, label);
                    } else {
                      handleChangeRole(m.agent_id, newRole);
                    }
                  }}
                  className="text-xs px-2 py-1 rounded border bg-background"
                >
                  {ROLES.map(r => <option key={r} value={r}>{r === "custom" ? (m.role === "custom" && m.custom_role ? m.custom_role : "Custom...") : r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
                </select>
                <RoleBadge role={m.role} customRole={m.custom_role} />
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleRemoveMember(m.agent_id)} title="Remove">
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent>
          <DialogHeader><DialogTitle>Team Settings</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="team-name-edit">Name</Label>
              <Input id="team-name-edit" value={editName} onChange={e => setEditName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="team-desc-edit">Description</Label>
              <Textarea id="team-desc-edit" value={editDesc} onChange={e => setEditDesc(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="destructive" onClick={handleDelete} className="mr-auto"><Trash2 className="h-4 w-4 mr-1" /> Delete</Button>
            <Button variant="ghost" onClick={() => setShowSettings(false)}>Cancel</Button>
            <Button onClick={handleSaveSettings}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAddMember} onOpenChange={setShowAddMember}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Agent to Team</DialogTitle></DialogHeader>
          <form onSubmit={handleAddMember} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="add-agent">Agent</Label>
              <select id="add-agent" value={addAgentId} onChange={e => setAddAgentId(e.target.value)} className="w-full px-3 py-2 border rounded bg-background text-sm">
                <option value="">— select an agent —</option>
                {availableAgents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-role">Role</Label>
              <select id="add-role" value={addRole} onChange={e => setAddRole(e.target.value as Role)} className="w-full px-3 py-2 border rounded bg-background text-sm">
                {ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
              </select>
            </div>
            {addRole === "custom" && (
              <div className="space-y-2">
                <Label htmlFor="add-custom-role">Custom role label</Label>
                <Input id="add-custom-role" value={addCustomRole} onChange={e => setAddCustomRole(e.target.value)} placeholder="e.g. QA, Designer, Architect" />
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setShowAddMember(false)}>Cancel</Button>
              <Button type="submit">Add</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
