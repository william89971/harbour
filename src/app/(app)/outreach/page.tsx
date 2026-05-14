"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Send, Plus } from "lucide-react";
import { timeAgo } from "@/lib/time";
import { EmptyState } from "@/components/app/empty-state";
import { RoleGate } from "@/components/app/role-gate";

type OutreachStatus = "draft" | "pending_approval" | "approved" | "sent" | "rejected" | "archived";

type Outreach = {
  id: string;
  subject: string;
  body: string;
  status: OutreachStatus;
  contact_id: string | null;
  company_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  company_name: string | null;
  created_at: number;
  updated_at: number;
};

type Contact = { id: string; name: string; email: string | null; company_id: string | null };
type Company = { id: string; name: string };

const STATUS_FILTERS: { id: string; label: string; statuses?: OutreachStatus[] }[] = [
  { id: "all", label: "All" },
  { id: "draft", label: "Draft", statuses: ["draft"] },
  { id: "pending_approval", label: "Pending approval", statuses: ["pending_approval"] },
  { id: "approved", label: "Approved", statuses: ["approved"] },
  { id: "sent", label: "Sent", statuses: ["sent"] },
  { id: "rejected", label: "Rejected", statuses: ["rejected"] },
  { id: "archived", label: "Archived", statuses: ["archived"] },
];

const statusBadgeVariant: Record<OutreachStatus, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "secondary",
  pending_approval: "default",
  approved: "default",
  sent: "outline",
  rejected: "destructive",
  archived: "outline",
};

export default function OutreachPage() {
  const qc = useQueryClient();
  const params = useSearchParams();
  const urlStatus = params.get("status");
  const initialFilter = STATUS_FILTERS.find(f => f.id === urlStatus)?.id ?? "all";
  const [filterId, setFilterId] = useState(initialFilter);
  const [showNew, setShowNew] = useState(false);

  const filter = STATUS_FILTERS.find(f => f.id === filterId) ?? STATUS_FILTERS[0];
  const statusParam = filter.statuses ? `?status=${filter.statuses.join(",")}` : "";

  const { data: drafts = [], isLoading } = useQuery<Outreach[]>({
    queryKey: ["outreach", filterId],
    queryFn: async () => {
      const r = await fetch(`/api/outreach${statusParam}`);
      if (!r.ok) return [];
      return r.json();
    },
    refetchInterval: 10_000,
  });

  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ["contacts", "all-for-outreach"],
    queryFn: async () => {
      const r = await fetch("/api/contacts");
      if (!r.ok) return [];
      return r.json();
    },
  });

  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ["companies", "all-for-outreach"],
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
          <h1 className="text-2xl font-semibold tracking-tight">Outreach</h1>
          <p className="text-sm text-muted-foreground mt-1">Drafted emails. Approval is required before any send.</p>
        </div>
        <RoleGate action="mutateOutreach">
          <Button size="sm" onClick={() => setShowNew(true)}><Plus className="h-4 w-4 mr-1" /> New Draft</Button>
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

      {drafts.length === 0 ? (
        <EmptyState large icon={<Send className="h-10 w-10 text-muted-foreground/40" />}>
          {filterId === "all"
            ? "No outreach drafts yet."
            : `No drafts in ${filter.label.toLowerCase()}.`}
        </EmptyState>
      ) : (
        <div className="space-y-2">
          {drafts.map(d => (
            <Link
              key={d.id}
              href={`/outreach/${d.id}`}
              className="flex items-start gap-3 rounded-lg border p-3 hover:bg-accent/50 transition-colors"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Send className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium truncate">{d.subject}</span>
                  <Badge variant={statusBadgeVariant[d.status]} className="text-[10px]">{d.status.replace(/_/g, " ")}</Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 truncate">
                  {d.contact_name ? `${d.contact_name}` : "(no contact)"}
                  {d.contact_email && ` · ${d.contact_email}`}
                  {d.company_name && ` · ${d.company_name}`}
                </div>
              </div>
              <span className="text-xs text-muted-foreground shrink-0">{timeAgo(d.updated_at)}</span>
            </Link>
          ))}
        </div>
      )}

      <NewOutreachDialog
        open={showNew}
        onOpenChange={setShowNew}
        contacts={contacts}
        companies={companies}
        onSaved={() => qc.invalidateQueries({ queryKey: ["outreach"] })}
      />
    </div>
  );
}

function NewOutreachDialog({
  open, onOpenChange, contacts, companies, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  contacts: Contact[];
  companies: Company[];
  onSaved: () => void;
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [contactId, setContactId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim() || !body.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/outreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: subject.trim(),
          body,
          contact_id: contactId || null,
          company_id: companyId || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error || "Save failed");
        return;
      }
      onOpenChange(false);
      setSubject(""); setBody(""); setContactId(""); setCompanyId("");
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>New Outreach Draft</DialogTitle></DialogHeader>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-1">
            <Label className="text-xs">Subject</Label>
            <Input value={subject} onChange={e => setSubject(e.target.value)} autoFocus required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Contact (optional)</Label>
              <select
                value={contactId}
                onChange={e => setContactId(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">— No contact —</option>
                {contacts.map(c => <option key={c.id} value={c.id}>{c.name}{c.email ? ` <${c.email}>` : ""}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Company (optional)</Label>
              <select
                value={companyId}
                onChange={e => setCompanyId(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">— No company —</option>
                {companies.map(co => <option key={co.id} value={co.id}>{co.name}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Body</Label>
            <Textarea value={body} onChange={e => setBody(e.target.value)} rows={10} required />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving || !subject.trim() || !body.trim()}>{saving ? "Saving..." : "Create draft"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
