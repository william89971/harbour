"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Building2, Plus } from "lucide-react";
import { timeAgo } from "@/lib/time";
import { EmptyState } from "@/components/app/empty-state";
import { RoleGate } from "@/components/app/role-gate";

type CompanyStatus = "prospect" | "customer" | "partner" | "archived";
type Company = {
  id: string;
  name: string;
  website: string | null;
  industry: string | null;
  status: CompanyStatus;
  notes: string | null;
  created_at: number;
  updated_at: number;
};

const STATUS_FILTERS: { id: string; label: string; statuses?: CompanyStatus[] }[] = [
  { id: "all", label: "All" },
  { id: "prospect", label: "Prospect", statuses: ["prospect"] },
  { id: "customer", label: "Customer", statuses: ["customer"] },
  { id: "partner", label: "Partner", statuses: ["partner"] },
  { id: "archived", label: "Archived", statuses: ["archived"] },
];

const statusBadgeVariant: Record<CompanyStatus, "default" | "secondary" | "outline"> = {
  prospect: "default",
  customer: "secondary",
  partner: "outline",
  archived: "outline",
};

export default function CompaniesPage() {
  const qc = useQueryClient();
  const [filterId, setFilterId] = useState("all");
  const [editing, setEditing] = useState<Company | null>(null);
  const [showNew, setShowNew] = useState(false);

  const filter = STATUS_FILTERS.find(f => f.id === filterId) ?? STATUS_FILTERS[0];
  const statusParam = filter.statuses ? `?status=${filter.statuses[0]}` : "";

  const { data: companies = [], isLoading } = useQuery<Company[]>({
    queryKey: ["companies", filterId],
    queryFn: async () => {
      const r = await fetch(`/api/companies${statusParam}`);
      if (!r.ok) return [];
      return r.json();
    },
    refetchInterval: 10_000,
  });

  if (isLoading) return <div className="text-sm text-muted-foreground py-12 text-center">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Companies</h1>
          <p className="text-sm text-muted-foreground mt-1">Accounts, customers, partners, and prospects.</p>
        </div>
        <RoleGate action="mutateCompany">
          <Button size="sm" onClick={() => setShowNew(true)}><Plus className="h-4 w-4 mr-1" /> New Company</Button>
        </RoleGate>
      </div>

      <div className="flex items-center gap-1 text-sm">
        {STATUS_FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => setFilterId(f.id)}
            className={`px-3 py-1 rounded-full transition-colors ${
              f.id === filterId
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {companies.length === 0 ? (
        <EmptyState large icon={<Building2 className="h-10 w-10 text-muted-foreground/40" />}>
          {filterId === "all"
            ? "No companies yet. Add a prospect to start growth."
            : `No companies in ${filter.label.toLowerCase()}.`}
        </EmptyState>
      ) : (
        <div className="space-y-2">
          {companies.map(c => (
            <button
              key={c.id}
              onClick={() => setEditing(c)}
              className="w-full text-left flex items-start gap-3 rounded-lg border p-3 hover:bg-accent/50 transition-colors"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Building2 className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium truncate">{c.name}</span>
                  <Badge variant={statusBadgeVariant[c.status]} className="text-[10px]">{c.status}</Badge>
                  {c.industry && <Badge variant="outline" className="text-[10px]">{c.industry}</Badge>}
                </div>
                {c.website && (
                  <div className="text-xs text-muted-foreground mt-0.5 truncate">{c.website}</div>
                )}
              </div>
              <span className="text-xs text-muted-foreground shrink-0">{timeAgo(c.updated_at)}</span>
            </button>
          ))}
        </div>
      )}

      <CompanyDialog
        open={showNew}
        onOpenChange={setShowNew}
        onSaved={() => qc.invalidateQueries({ queryKey: ["companies"] })}
      />
      {editing && (
        <CompanyDialog
          open={!!editing}
          onOpenChange={open => { if (!open) setEditing(null); }}
          existing={editing}
          onSaved={() => { qc.invalidateQueries({ queryKey: ["companies"] }); setEditing(null); }}
        />
      )}
    </div>
  );
}

function CompanyDialog({
  open,
  onOpenChange,
  existing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  existing?: Company;
  onSaved: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [website, setWebsite] = useState(existing?.website ?? "");
  const [industry, setIndustry] = useState(existing?.industry ?? "");
  const [status, setStatus] = useState<CompanyStatus>(existing?.status ?? "prospect");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const url = existing ? `/api/companies/${existing.id}` : "/api/companies";
      const method = existing ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          website: website || null,
          industry: industry || null,
          status,
          notes: notes || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error || "Save failed");
        return;
      }
      onOpenChange(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!existing) return;
    if (!confirm("Delete this company? Linked contacts will be unlinked.")) return;
    const res = await fetch(`/api/companies/${existing.id}`, { method: "DELETE" });
    if (res.ok) { onOpenChange(false); onSaved(); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{existing ? "Edit Company" : "New Company"}</DialogTitle></DialogHeader>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-1">
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} autoFocus required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Website</Label>
              <Input value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://..." />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Industry</Label>
              <Input value={industry} onChange={e => setIndustry(e.target.value)} placeholder="SaaS, fintech…" />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Status</Label>
            <select
              value={status}
              onChange={e => setStatus(e.target.value as CompanyStatus)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="prospect">prospect</option>
              <option value="customer">customer</option>
              <option value="partner">partner</option>
              <option value="archived">archived</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Notes</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4} />
          </div>
          <DialogFooter className="gap-2">
            {existing && (
              <Button type="button" variant="ghost" onClick={handleDelete}>Delete</Button>
            )}
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving ? "Saving..." : existing ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
