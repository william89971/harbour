"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BackLink } from "@/components/app/back-link";
import { CheckSquare, Save, Trash2 } from "lucide-react";
import { timeAgo } from "@/lib/time";
import { RoleGate } from "@/components/app/role-gate";

type Task = {
  id: string;
  title: string;
  notes: string | null;
  status: "todo" | "doing" | "blocked" | "done" | "archived";
  priority: "low" | "medium" | "high";
  owner_type: "user" | "agent" | "none";
  owner_id: string | null;
  goal_id: string | null;
  due_date: number | null;
  created_at: number;
  updated_at: number;
};

type Goal = { id: string; title: string };

const STATUSES: Task["status"][] = ["todo", "doing", "blocked", "done", "archived"];
const PRIORITIES: Task["priority"][] = ["low", "medium", "high"];
const OWNER_TYPES: Task["owner_type"][] = ["none", "user", "agent"];

function dateToInputValue(ts: number | null): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  return d.toISOString().slice(0, 10);
}
function inputValueToTs(v: string): number | null {
  if (!v) return null;
  return Math.floor(new Date(v + "T00:00:00").getTime() / 1000);
}

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();

  const { data: task = null, isLoading: loading } = useQuery<Task | null>({
    queryKey: ["tasks", id],
    queryFn: async () => {
      const res = await fetch(`/api/tasks/${id}`);
      if (!res.ok) return null;
      return res.json();
    },
  });

  const { data: goals = [] } = useQuery<Goal[]>({
    queryKey: ["goals", "all-for-task"],
    queryFn: async () => {
      const res = await fetch(`/api/goals`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  if (loading) return <div className="text-sm text-muted-foreground py-12 text-center">Loading...</div>;
  if (!task) return <div className="text-sm text-muted-foreground py-12 text-center">Task not found.</div>;

  return <TaskForm key={task.id + ":" + task.updated_at} task={task} goals={goals} />;
}

function TaskForm({ task, goals }: { task: Task; goals: Goal[] }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? "");
  const [status, setStatus] = useState<Task["status"]>(task.status);
  const [priority, setPriority] = useState<Task["priority"]>(task.priority);
  const [ownerType, setOwnerType] = useState<Task["owner_type"]>(task.owner_type);
  const [ownerId, setOwnerId] = useState(task.owner_id ?? "");
  const [goalId, setGoalId] = useState(task.goal_id ?? "");
  const [dueDate, setDueDate] = useState(dateToInputValue(task.due_date));
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!title.trim()) return;
    setSaving(true);
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        notes: notes || null,
        status,
        priority,
        owner_type: ownerType,
        owner_id: ownerType === "none" ? null : (ownerId || null),
        goal_id: goalId || null,
        due_date: inputValueToTs(dueDate),
      }),
    });
    setSaving(false);
    if (res.ok) queryClient.invalidateQueries({ queryKey: ["tasks"] });
  }

  async function handleDelete() {
    if (!confirm("Delete this task?")) return;
    const res = await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
    if (res.ok) router.push("/tasks");
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <BackLink href="/tasks" label="Back to Tasks" />
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
          <CheckSquare className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-semibold tracking-tight">{task.title}</h1>
            <Badge variant="outline" className="text-[10px]">{task.status}</Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">Updated {timeAgo(task.updated_at)}</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Title</Label>
          <Input value={title} onChange={e => setTitle(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Notes</Label>
          <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={6} placeholder="What needs doing, links, follow-ups..." />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as Task["status"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Priority</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as Task["priority"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Owner type</Label>
            <Select value={ownerType} onValueChange={(v) => setOwnerType(v as Task["owner_type"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {OWNER_TYPES.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Owner ID</Label>
            <Input
              value={ownerId}
              onChange={e => setOwnerId(e.target.value)}
              placeholder={ownerType === "none" ? "—" : "user id or agent id"}
              disabled={ownerType === "none"}
            />
          </div>
          <div className="space-y-2">
            <Label>Goal</Label>
            <select
              value={goalId}
              onChange={e => setGoalId(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="">— No goal —</option>
              {goals.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label>Due date</Label>
            <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </div>
        </div>
        <RoleGate action="mutateTask">
          <div className="flex items-center gap-2 pt-2">
            <Button onClick={handleSave} disabled={saving || !title.trim()}>
              <Save className="h-4 w-4 mr-1.5" /> {saving ? "Saving..." : "Save"}
            </Button>
            <Button variant="ghost" onClick={handleDelete}>
              <Trash2 className="h-4 w-4 mr-1.5" /> Delete
            </Button>
          </div>
        </RoleGate>
      </div>
    </div>
  );
}
