"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Trash2, Plus, Copy, Check } from "lucide-react";
import { useApp } from "@/components/app/app-context";
import { useRouter } from "next/navigation";

type Settings = Record<string, string>;

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { projects, activeProjectId, setActiveProjectId } = useApp();
  const activeProject = activeProjectId ? projects.find(p => p.id === activeProjectId) : null;

  const [tzSearch, setTzSearch] = useState("");
  const [tzOpen, setTzOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectNameLoaded, setProjectNameLoaded] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Admin API keys
  const [newKeyName, setNewKeyName] = useState("");
  const [showNewKey, setShowNewKey] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Sync project name when active project changes
  if (activeProject && (!projectNameLoaded || projectName === "")) {
    setProjectName(activeProject.name);
    setProjectNameLoaded(true);
  }
  if (!activeProject && projectNameLoaded) {
    setProjectNameLoaded(false);
  }

  async function handleRenameProject() {
    if (!activeProjectId || !projectName.trim() || projectName === activeProject?.name) return;
    await fetch(`/api/projects/${activeProjectId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: projectName.trim() }),
    });
    queryClient.invalidateQueries({ queryKey: ["projects"] });
  }

  async function handleDeleteProject() {
    if (!activeProjectId) return;
    setDeleting(true);
    await fetch(`/api/projects/${activeProjectId}`, { method: "DELETE" });
    setActiveProjectId(null);
    queryClient.invalidateQueries({ queryKey: ["projects"] });
    setShowDeleteConfirm(false);
    setDeleting(false);
    router.push("/");
  }

  const { data: settings, isLoading } = useQuery<Settings>({
    queryKey: ["settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings");
      if (!res.ok) return {};
      return res.json();
    },
  });

  const { data: timezones = [] } = useQuery<string[]>({
    queryKey: ["timezones"],
    queryFn: async () => {
      const res = await fetch("/api/settings/timezones");
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: adminKeys = [] } = useQuery<any[]>({
    queryKey: ["admin-api-keys"],
    queryFn: async () => {
      const res = await fetch("/api/admin-api-keys");
      if (!res.ok) return [];
      return res.json();
    },
  });

  const createKeyMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch("/api/admin-api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error("Failed to create key");
      return res.json();
    },
    onSuccess: (data) => {
      setCreatedKey(data.apiKey);
      setNewKeyName("");
      queryClient.invalidateQueries({ queryKey: ["admin-api-keys"] });
    },
  });

  const deleteKeyMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/admin-api-keys/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-api-keys"] });
    },
  });

  const filteredTimezones = useMemo(() => {
    if (!tzSearch) return timezones;
    const lower = tzSearch.toLowerCase();
    return timezones.filter(tz => tz.toLowerCase().includes(lower));
  }, [timezones, tzSearch]);

  async function updateSetting(key: string, value: string) {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: value }),
    });
    if (!res.ok) { alert("Failed to update setting"); return; }
    queryClient.invalidateQueries({ queryKey: ["settings"] });
  }

  if (isLoading) return <div className="text-sm text-muted-foreground py-12 text-center">Loading...</div>;

  const timezone = settings?.timezone || "";
  const signupEnabled = settings?.signup_enabled !== "false";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">System-wide configuration.</p>
      </div>

      <div className="space-y-6 max-w-lg">
        {/* Project Settings */}
        {activeProject && (
          <div className="rounded-lg border p-4 space-y-4">
            <div>
              <Label className="text-base font-medium">Project</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Manage the current project.</p>
            </div>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={projectName}
                onChange={e => setProjectName(e.target.value)}
                onBlur={handleRenameProject}
                onKeyDown={e => { if (e.key === "Enter") handleRenameProject(); }}
                className="text-sm"
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-destructive/20 bg-destructive/5 p-3">
              <div>
                <p className="text-sm font-medium">Delete project</p>
                <p className="text-xs text-muted-foreground">Removes the project and all links. Agents, jobs, docs, and env vars are not deleted.</p>
              </div>
              <Button variant="destructive" size="sm" onClick={() => setShowDeleteConfirm(true)}>
                <Trash2 className="h-4 w-4 mr-1.5" /> Delete
              </Button>
            </div>
          </div>
        )}

        {/* Timezone */}
        <div className="space-y-2">
          <Label>Timezone</Label>
          <p className="text-xs text-muted-foreground">Used for scheduling jobs and displaying times.</p>
          <div className="relative">
            <Input
              value={tzOpen ? tzSearch : timezone}
              onChange={e => { setTzSearch(e.target.value); setTzOpen(true); }}
              onFocus={() => { setTzSearch(""); setTzOpen(true); }}
              onBlur={() => setTimeout(() => setTzOpen(false), 200)}
              placeholder="Search timezones..."
              className="font-mono text-sm"
            />
            {tzOpen && filteredTimezones.length > 0 && (
              <div className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto rounded-lg border bg-popover shadow-md">
                {filteredTimezones.slice(0, 50).map(tz => (
                  <button
                    key={tz}
                    type="button"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => {
                      updateSetting("timezone", tz);
                      setTzOpen(false);
                      setTzSearch("");
                    }}
                    className={`w-full text-left px-3 py-2 text-sm font-mono hover:bg-accent transition-colors ${tz === timezone ? "bg-accent/50 font-medium" : ""}`}
                  >
                    {tz}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Recent Runs Limit */}
        <div className="space-y-2">
          <Label>Recent Runs Shown</Label>
          <p className="text-xs text-muted-foreground">Number of completed runs to display on the main Runs page.</p>
          <Input
            type="number"
            min={1}
            className="font-mono text-sm w-32"
            value={settings?.recent_runs_limit || "10"}
            onChange={e => {
              const v = parseInt(e.target.value, 10);
              if (v > 0) updateSetting("recent_runs_limit", String(v));
            }}
          />
        </div>

        {/* Signup */}
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <Label>Allow Signup</Label>
            <p className="text-xs text-muted-foreground mt-0.5">When disabled, new users cannot register.</p>
          </div>
          <button
            onClick={() => updateSetting("signup_enabled", signupEnabled ? "false" : "true")}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors ${signupEnabled ? "bg-primary" : "bg-muted"}`}
          >
            <span className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform mt-0.5 ${signupEnabled ? "translate-x-5.5 ml-0.5" : "translate-x-0.5"}`} />
          </button>
        </div>

        {/* Admin API Keys */}
        <div className="rounded-lg border p-4 space-y-4">
          <div>
            <Label className="text-base font-medium">Admin API Keys</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Keys for external agents to manage Harbour. Each key has full admin access.
            </p>
          </div>
          {adminKeys.length > 0 && (
            <div className="space-y-2">
              {adminKeys.map((key: any) => (
                <div key={key.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{key.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Created {new Date(key.created_at * 1000).toLocaleDateString()}
                      {key.last_used_at && <> &middot; Last used {new Date(key.last_used_at * 1000).toLocaleDateString()}</>}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8" onClick={() => deleteKeyMutation.mutate(key.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <Button variant="outline" size="sm" onClick={() => setShowNewKey(true)}>
            <Plus className="h-4 w-4 mr-1.5" /> New Key
          </Button>
        </div>
      </div>

      {/* Create admin key dialog */}
      <Dialog open={showNewKey} onOpenChange={(open) => { setShowNewKey(open); if (!open) setNewKeyName(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Admin API Key</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Give this key a name to identify which agent or integration uses it.</p>
            <Input
              placeholder="e.g. Claude Code assistant"
              value={newKeyName}
              onChange={e => setNewKeyName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && newKeyName.trim()) { createKeyMutation.mutate(newKeyName.trim()); setShowNewKey(false); } }}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowNewKey(false)}>Cancel</Button>
            <Button
              disabled={!newKeyName.trim() || createKeyMutation.isPending}
              onClick={() => { createKeyMutation.mutate(newKeyName.trim()); setShowNewKey(false); }}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Show created key dialog */}
      <Dialog open={!!createdKey} onOpenChange={(open) => { if (!open) { setCreatedKey(null); setCopied(false); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Admin API Key Created</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Copy this invite and paste it into your management agent. The key won&apos;t be shown again.</p>
            <div className="rounded-md bg-muted px-3 py-2 text-xs font-mono whitespace-pre-wrap break-all select-all max-h-64 overflow-y-auto">
              {`You have admin access to a Harbour instance — a control plane for AI agents.\n\nSave these credentials now:\n- Admin API Key: ${createdKey}\n- Base URL: ${typeof window !== "undefined" ? window.location.origin : ""}\n\nTo get started, fetch the admin guide:\n  GET ${typeof window !== "undefined" ? window.location.origin : ""}/api/admin-guide\n  Authorization: Bearer ${createdKey}\n\nThe guide covers every endpoint you can use to manage agents, jobs, runs, docs, databases, env vars, projects, and settings.`}
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                const base = typeof window !== "undefined" ? window.location.origin : "";
                navigator.clipboard.writeText(`You have admin access to a Harbour instance — a control plane for AI agents.\n\nSave these credentials now:\n- Admin API Key: ${createdKey}\n- Base URL: ${base}\n\nTo get started, fetch the admin guide:\n  GET ${base}/api/admin-guide\n  Authorization: Bearer ${createdKey}\n\nThe guide covers every endpoint you can use to manage agents, jobs, runs, docs, databases, env vars, projects, and settings.`);
                setCopied(true);
              }}
            >
              {copied ? <><Check className="h-4 w-4 mr-1.5" /> Copied</> : <><Copy className="h-4 w-4 mr-1.5" /> Copy Invite</>}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {activeProject?.name}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will remove the project and all its links. Your agents, jobs, docs, and env vars will not be deleted.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowDeleteConfirm(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteProject} disabled={deleting}>
              {deleting ? "Deleting..." : "Delete Project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
