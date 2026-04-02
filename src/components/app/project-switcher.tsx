"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useApp } from "./app-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FolderOpen, ChevronDown, Plus, Check } from "lucide-react";

export function ProjectSwitcher() {
  const { projects, activeProjectId, setActiveProjectId } = useApp();
  const queryClient = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const activeProject = activeProjectId ? projects.find(p => p.id === activeProjectId) : null;

  function handleSelect(id: string | null) {
    setActiveProjectId(id);
    // Invalidate all list queries so they refetch with the new project filter
    queryClient.invalidateQueries({ queryKey: ["agents"] });
    queryClient.invalidateQueries({ queryKey: ["jobs"] });
    queryClient.invalidateQueries({ queryKey: ["runs"] });
    queryClient.invalidateQueries({ queryKey: ["docs"] });
    queryClient.invalidateQueries({ queryKey: ["env-vars"] });
    queryClient.invalidateQueries({ queryKey: ["databases"] });
    queryClient.invalidateQueries({ queryKey: ["runs", "waiting-count"] });
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    if (res.ok) {
      const project = await res.json();
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setNewName("");
      setShowNew(false);
      // Auto-select the new project
      handleSelect(project.id);
    }
    setCreating(false);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors">
          <FolderOpen className="h-4 w-4 shrink-0" />
          <span className="flex-1 truncate text-left">{activeProject ? activeProject.name : "All Projects"}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          <DropdownMenuItem onClick={() => handleSelect(null)}>
            <span className="flex-1">All Projects</span>
            {!activeProjectId && <Check className="h-4 w-4 ml-2 text-primary" />}
          </DropdownMenuItem>
          {projects.length > 0 && <DropdownMenuSeparator />}
          {projects.map(p => (
            <DropdownMenuItem key={p.id} onClick={() => handleSelect(p.id)}>
              <span className="flex-1 truncate">{p.name}</span>
              {activeProjectId === p.id && <Check className="h-4 w-4 ml-2 text-primary" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Project
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent>
          <DialogHeader><DialogTitle>New Project</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Marketing" autoFocus required />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setShowNew(false)}>Cancel</Button>
              <Button type="submit" disabled={creating}>{creating ? "Creating..." : "Create"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
