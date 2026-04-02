"use client";

import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Trash2 } from "lucide-react";
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
      </div>

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
