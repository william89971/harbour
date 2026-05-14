"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Users, Plus, Building2 } from "lucide-react";
import { timeAgo } from "@/lib/time";
import { EmptyState } from "@/components/app/empty-state";
import { RoleGate } from "@/components/app/role-gate";

type ContactStatus = "new" | "researched" | "drafted" | "contacted" | "replied" | "archived";
type Contact = {
  id: string;
  name: string;
  email: string | null;
  company_id: string | null;
  company_name: string | null;
  title: string | null;
  source: string | null;
  status: ContactStatus;
  notes: string | null;
  created_at: number;
  updated_at: number;
};
type Company = { id: string; name: string };

const STATUS_FILTERS: { id: string; label: string; statuses?: ContactStatus[] }[] = [
  { id: "all", label: "All" },
  { id: "new", label: "New", statuses: ["new"] },
  { id: "researched", label: "Researched", statuses: ["researched"] },
  { id: "contacted", label: "Contacted", statuses: ["contacted"] },
  { id: "replied", label: "Replied", statuses: ["replied"] },
  { id: "archived", label: "Archived", statuses: ["archived"] },
];

const statusBadgeVariant: Record<ContactStatus, "default" | "secondary" | "outline" | "destructive"> = {
  new: "secondary",
  researched: "default",
  drafted: "default",
  contacted: "outline",
  replied: "default",
  archived: "outline",
};

export default function ContactsPage() {
  const qc = useQueryClient();
  const [filterId, setFilterId] = useState("all");
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);

  const filter = STATUS_FILTERS.find(f => f.id === filterId) ?? STATUS_FILTERS[0];
  const statusParam = filter.statuses ? `?status=${filter.statuses.join(",")}` : "";

  const { data: contacts = [], isLoading } = useQuery<Contact[]>({
    queryKey: ["contacts", filterId],
    queryFn: async () => {
      const r = await fetch(`/api/contacts${statusParam}`);
      if (!r.ok) return [];
      return r.json();
    },
    refetchInterval: 10_000,
  });

  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ["companies", "for-contacts"],
    queryFn: async () => {
      const r = await fetch("/api/companies");
      if (!r.ok) return [];
      return r.json();
    },
  });

  if (isLoading) return <div className="text-sm text-muted-foreground py-12 text-center">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
          <p className="text-sm text-muted-foreground mt-1">Prospects and people in your growth loop.</p>
        </div>
        <RoleGate action="mutateContact">
          <Button size="sm" onClick={() => setShowNew(true)}><Plus className="h-4 w-4 mr-1" /> New Contact</Button>
        </RoleGate>
      </div>

      <div className="flex items-center gap-1 text-sm flex-wrap">
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

      {contacts.length === 0 ? (
        <EmptyState large icon={<Users className="h-10 w-10 text-muted-foreground/40" />}>
          {filterId === "all"
            ? "No contacts yet. Add a prospect to start growth."
            : `No contacts in ${filter.label.toLowerCase()}.`}
        </EmptyState>
      ) : (
        <div className="space-y-2">
          {contacts.map(c => (
            <button
              key={c.id}
              onClick={() => setEditing(c)}
              className="w-full text-left flex items-start gap-3 rounded-lg border p-3 hover:bg-accent/50 transition-colors"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Users className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium truncate">{c.name}</span>
                  {c.title && <span className="text-xs text-muted-foreground">{c.title}</span>}
                  <Badge variant={statusBadgeVariant[c.status]} className="text-[10px]">{c.status}</Badge>
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                  {c.email && <span className="truncate">{c.email}</span>}
                  {c.company_name && (
                    <span className="inline-flex items-center gap-1"><Building2 className="h-3 w-3" />{c.company_name}</span>
                  )}
                </div>
              </div>
              <span className="text-xs text-muted-foreground shrink-0">{timeAgo(c.updated_at)}</span>
            </button>
          ))}
        </div>
      )}

      <ContactDialog
        open={showNew}
        onOpenChange={setShowNew}
        companies={companies}
        onSaved={() => qc.invalidateQueries({ queryKey: ["contacts"] })}
      />
      {editing && (
        <ContactDialog
          open={!!editing}
          onOpenChange={open => { if (!open) setEditing(null); }}
          companies={companies}
          existing={editing}
          onSaved={() => { qc.invalidateQueries({ queryKey: ["contacts"] }); setEditing(null); }}
        />
      )}
    </div>
  );
}

function ContactDialog({
  open,
  onOpenChange,
  existing,
  companies,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  existing?: Contact;
  companies: Company[];
  onSaved: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [email, setEmail] = useState(existing?.email ?? "");
  const [companyId, setCompanyId] = useState(existing?.company_id ?? "");
  const [title, setTitle] = useState(existing?.title ?? "");
  const [source, setSource] = useState(existing?.source ?? "");
  const [status, setStatus] = useState<ContactStatus>(existing?.status ?? "new");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const url = existing ? `/api/contacts/${existing.id}` : "/api/contacts";
      const method = existing ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email || null,
          company_id: companyId || null,
          title: title || null,
          source: source || null,
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
    if (!confirm("Delete this contact? Linked outreach drafts will be unlinked.")) return;
    const res = await fetch(`/api/contacts/${existing.id}`, { method: "DELETE" });
    if (res.ok) { onOpenChange(false); onSaved(); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{existing ? "Edit Contact" : "New Contact"}</DialogTitle></DialogHeader>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Name</Label>
              <Input value={name} onChange={e => setName(e.target.value)} autoFocus required />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Email</Label>
              <Input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="name@company.com" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Title</Label>
              <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Head of Eng" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Source</Label>
              <Input value={source} onChange={e => setSource(e.target.value)} placeholder="LinkedIn / referral / …" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Company</Label>
              <select
                value={companyId}
                onChange={e => setCompanyId(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">— No company —</option>
                {companies.map(co => <option key={co.id} value={co.id}>{co.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value as ContactStatus)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="new">new</option>
                <option value="researched">researched</option>
                <option value="drafted">drafted</option>
                <option value="contacted">contacted</option>
                <option value="replied">replied</option>
                <option value="archived">archived</option>
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Notes</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4} />
          </div>
          <DialogFooter className="gap-2">
            {existing && <Button type="button" variant="ghost" onClick={handleDelete}>Delete</Button>}
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
