"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { BackLink } from "@/components/app/back-link";
import { Scale, Save, Trash2 } from "lucide-react";
import { timeAgo } from "@/lib/time";
import { RoleGate } from "@/components/app/role-gate";

type Decision = {
  id: string;
  title: string;
  decision: string;
  rationale: string | null;
  consequences: string | null;
  created_at: number;
  updated_at: number;
};

export default function DecisionDetailPage() {
  const { id } = useParams<{ id: string }>();

  const { data: decision = null, isLoading: loading } = useQuery<Decision | null>({
    queryKey: ["decisions", id],
    queryFn: async () => {
      const res = await fetch(`/api/decisions/${id}`);
      if (!res.ok) return null;
      return res.json();
    },
  });

  if (loading) return <div className="text-sm text-muted-foreground py-12 text-center">Loading...</div>;
  if (!decision) return <div className="text-sm text-muted-foreground py-12 text-center">Decision not found.</div>;

  return <DecisionForm key={decision.id + ":" + decision.updated_at} decision={decision} />;
}

function DecisionForm({ decision }: { decision: Decision }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(decision.title);
  const [decisionText, setDecisionText] = useState(decision.decision);
  const [rationale, setRationale] = useState(decision.rationale ?? "");
  const [consequences, setConsequences] = useState(decision.consequences ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!title.trim() || !decisionText.trim()) return;
    setSaving(true);
    const res = await fetch(`/api/decisions/${decision.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        decision: decisionText.trim(),
        rationale: rationale || null,
        consequences: consequences || null,
      }),
    });
    setSaving(false);
    if (res.ok) queryClient.invalidateQueries({ queryKey: ["decisions"] });
  }

  async function handleDelete() {
    if (!confirm("Delete this decision record?")) return;
    const res = await fetch(`/api/decisions/${decision.id}`, { method: "DELETE" });
    if (res.ok) router.push("/decisions");
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <BackLink href="/decisions" label="Back to Decisions" />
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
          <Scale className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-semibold tracking-tight">{decision.title}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Recorded {timeAgo(decision.created_at)}</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Title</Label>
          <Input value={title} onChange={e => setTitle(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Decision</Label>
          <Textarea value={decisionText} onChange={e => setDecisionText(e.target.value)} rows={4} />
        </div>
        <div className="space-y-2">
          <Label>Rationale</Label>
          <Textarea value={rationale} onChange={e => setRationale(e.target.value)} rows={4} placeholder="Why we chose this." />
        </div>
        <div className="space-y-2">
          <Label>Consequences</Label>
          <Textarea value={consequences} onChange={e => setConsequences(e.target.value)} rows={4} placeholder="Trade-offs, downstream impact, things to watch." />
        </div>
        <RoleGate action="mutateDecision">
          <div className="flex items-center gap-2 pt-2">
            <Button onClick={handleSave} disabled={saving || !title.trim() || !decisionText.trim()}>
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
