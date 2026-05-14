"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { BackLink } from "@/components/app/back-link";
import { RoleGate } from "@/components/app/role-gate";
import { Send, ShieldAlert, Save, Trash2, CheckCircle2, ExternalLink, XCircle, RotateCcw } from "lucide-react";
import { timeAgo } from "@/lib/time";

type OutreachStatus = "draft" | "pending_approval" | "approved" | "sent" | "rejected" | "archived";

type Outreach = {
  id: string;
  subject: string;
  body: string;
  status: OutreachStatus;
  contact_id: string | null;
  company_id: string | null;
  approval_request_id: string | null;
  created_at: number;
  updated_at: number;
  approval?: {
    id: string;
    status: "pending" | "approved" | "rejected" | "expired";
    approval_comment: string | null;
    risk_level: string;
  } | null;
};

type Contact = { id: string; name: string; email: string | null };
type Company = { id: string; name: string };
type GmailPublicConfig = { configured: boolean };

export default function OutreachDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const { data: draft = null, isLoading } = useQuery<Outreach | null>({
    queryKey: ["outreach", id],
    queryFn: async () => {
      const r = await fetch(`/api/outreach/${id}`);
      if (!r.ok) return null;
      return r.json();
    },
    refetchInterval: 5000,
  });

  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ["contacts", "for-outreach-detail"],
    queryFn: async () => (await fetch("/api/contacts")).json().catch(() => []),
  });
  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ["companies", "for-outreach-detail"],
    queryFn: async () => (await fetch("/api/companies")).json().catch(() => []),
  });
  const { data: gmailCfg } = useQuery<GmailPublicConfig | null>({
    queryKey: ["gmail-config"],
    queryFn: async () => {
      const r = await fetch("/api/integrations/gmail/config");
      if (!r.ok) return null;
      return r.json();
    },
  });

  if (isLoading) return <div className="text-sm text-muted-foreground py-12 text-center">Loading...</div>;
  if (!draft) return <div className="text-sm text-muted-foreground py-12 text-center">Outreach draft not found.</div>;

  return <OutreachForm key={draft.id + ":" + draft.updated_at} draft={draft} contacts={contacts} companies={companies} gmailConfigured={!!gmailCfg?.configured} busy={busy} setBusy={setBusy} router={router} qc={qc} />;
}

function OutreachForm({
  draft, contacts, companies, gmailConfigured, busy, setBusy, router, qc,
}: {
  draft: Outreach;
  contacts: Contact[];
  companies: Company[];
  gmailConfigured: boolean;
  busy: boolean;
  setBusy: (v: boolean) => void;
  router: ReturnType<typeof useRouter>;
  qc: ReturnType<typeof useQueryClient>;
}) {
  const editable = draft.status === "draft";
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [contactId, setContactId] = useState(draft.contact_id ?? "");
  const [companyId, setCompanyId] = useState(draft.company_id ?? "");
  const [requestReason, setRequestReason] = useState("");
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const contactEmail = contacts.find(c => c.id === contactId)?.email ?? "";

  async function callJson(path: string, body?: unknown, method = "POST") {
    setBusy(true);
    setSavedNotice(null);
    try {
      const res = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { alert(json.error || "Action failed"); return null; }
      qc.invalidateQueries({ queryKey: ["outreach", draft.id] });
      qc.invalidateQueries({ queryKey: ["outreach"] });
      qc.invalidateQueries({ queryKey: ["today"] });
      qc.invalidateQueries({ queryKey: ["approvals"] });
      qc.invalidateQueries({ queryKey: ["approvals-count"] });
      return json;
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveDraft() {
    if (!subject.trim() || !body.trim()) return;
    await callJson(`/api/outreach/${draft.id}`, {
      subject: subject.trim(),
      body,
      contact_id: contactId || null,
      company_id: companyId || null,
    }, "PUT");
    setSavedNotice("Saved.");
  }

  async function handleRequestApproval() {
    await callJson(`/api/outreach/${draft.id}/request-approval`, {
      reason: requestReason.trim() || undefined,
    });
    setRequestReason("");
  }

  async function handleFinalize() {
    await callJson(`/api/outreach/${draft.id}/finalize`, {});
  }

  async function handleRevert() {
    await callJson(`/api/outreach/${draft.id}`, { status: "draft" }, "PUT");
  }

  async function handleMarkSent() {
    await callJson(`/api/outreach/${draft.id}/mark-sent`, {});
  }

  async function handleArchive() {
    await callJson(`/api/outreach/${draft.id}`, { status: "archived" }, "PUT");
  }

  async function handleDelete() {
    if (!confirm("Delete this draft? This cannot be undone.")) return;
    const r = await fetch(`/api/outreach/${draft.id}`, { method: "DELETE" });
    if (r.ok) router.push("/outreach");
  }

  async function handleCreateGmailDraft() {
    if (!contactEmail) {
      alert("Linked contact has no email address. Edit the contact first.");
      return;
    }
    const r = await callJson(`/api/integrations/gmail/drafts`, {
      to: contactEmail,
      subject: draft.subject,
      body: draft.body,
    });
    if (r && r.draftsUrl) {
      window.open(r.draftsUrl, "_blank", "noopener,noreferrer");
      setSavedNotice("Gmail draft created — review it in Gmail, then click 'Mark sent' below.");
    }
  }

  const approval = draft.approval;
  const approvalRejected = approval && approval.status === "rejected";
  const approvalApproved = approval && approval.status === "approved" && draft.status === "pending_approval";

  return (
    <div className="space-y-6 max-w-2xl">
      <BackLink href="/outreach" label="Back to Outreach" />
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
          <Send className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-semibold tracking-tight truncate">{draft.subject || "(no subject)"}</h1>
            <Badge variant="outline" className="text-[10px]">{draft.status.replace(/_/g, " ")}</Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">Updated {timeAgo(draft.updated_at)}</p>
        </div>
      </div>

      {/* Status banners */}
      {draft.status === "pending_approval" && !approvalRejected && !approvalApproved && (
        <section className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-amber-600" />
          <span className="text-sm">Pending approval. Review in <Link href="/approvals" className="underline">Approvals</Link>.</span>
        </section>
      )}
      {approvalApproved && (
        <section className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
            <span className="text-sm font-medium">Approved — ready to finalize</span>
          </div>
          {approval?.approval_comment && (
            <p className="text-xs text-muted-foreground italic">{approval.approval_comment}</p>
          )}
          <RoleGate action="mutateOutreach">
            <Button size="sm" onClick={handleFinalize} disabled={busy}>
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Finalize
            </Button>
          </RoleGate>
        </section>
      )}
      {approvalRejected && draft.status === "pending_approval" && (
        <section className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <XCircle className="h-4 w-4 text-rose-700 dark:text-rose-400" />
            <span className="text-sm font-medium">Rejected by approver</span>
          </div>
          {approval?.approval_comment && (
            <p className="text-xs text-muted-foreground italic">{approval.approval_comment}</p>
          )}
          <RoleGate action="mutateOutreach">
            <Button size="sm" variant="outline" onClick={handleRevert} disabled={busy}>
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Revert to draft
            </Button>
          </RoleGate>
        </section>
      )}
      {draft.status === "approved" && (
        <section className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
            <span className="text-sm font-medium">Approved — finalize the send</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Harbour never auto-sends. Create a Gmail draft (if configured) or copy the body manually,
            send from your inbox, then mark this row as sent below.
          </p>
          <RoleGate action="mutateOutreach">
            <div className="flex gap-2 flex-wrap">
              {gmailConfigured && contactEmail && (
                <Button size="sm" onClick={handleCreateGmailDraft} disabled={busy}>
                  <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Create Gmail draft
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={handleMarkSent} disabled={busy}>
                <Send className="h-3.5 w-3.5 mr-1.5" /> Mark sent
              </Button>
            </div>
          </RoleGate>
          {gmailConfigured && !contactEmail && (
            <p className="text-xs text-muted-foreground">Add an email to the linked contact to enable the Gmail draft button.</p>
          )}
        </section>
      )}
      {draft.status === "sent" && (
        <section className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 flex items-center gap-2">
          <Send className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
          <span className="text-sm">Marked sent · {timeAgo(draft.updated_at)}</span>
          <div className="ml-auto">
            <RoleGate action="mutateOutreach">
              <Button size="sm" variant="ghost" onClick={handleArchive} disabled={busy}>Archive</Button>
            </RoleGate>
          </div>
        </section>
      )}

      {/* Form */}
      <div className="space-y-4">
        <div className="space-y-1">
          <Label className="text-xs">Subject</Label>
          <Input value={subject} onChange={e => setSubject(e.target.value)} disabled={!editable} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Contact</Label>
            <select
              value={contactId}
              onChange={e => setContactId(e.target.value)}
              disabled={!editable}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
            >
              <option value="">— No contact —</option>
              {contacts.map(c => <option key={c.id} value={c.id}>{c.name}{c.email ? ` <${c.email}>` : ""}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Company</Label>
            <select
              value={companyId}
              onChange={e => setCompanyId(e.target.value)}
              disabled={!editable}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
            >
              <option value="">— No company —</option>
              {companies.map(co => <option key={co.id} value={co.id}>{co.name}</option>)}
            </select>
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Body</Label>
          <Textarea value={body} onChange={e => setBody(e.target.value)} rows={12} disabled={!editable} />
        </div>

        {editable && (
          <RoleGate action="mutateOutreach">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Button onClick={handleSaveDraft} disabled={busy || !subject.trim() || !body.trim()}>
                  <Save className="h-4 w-4 mr-1.5" /> Save draft
                </Button>
                <Button variant="ghost" onClick={handleDelete} disabled={busy}>
                  <Trash2 className="h-4 w-4 mr-1.5" /> Delete
                </Button>
              </div>
              <div className="rounded-lg border p-3 space-y-2">
                <Label className="text-xs">Request approval to contact this person</Label>
                <Textarea
                  value={requestReason}
                  onChange={e => setRequestReason(e.target.value)}
                  rows={2}
                  placeholder="Optional reason for the reviewer (why now, expected outcome)"
                />
                <Button size="sm" onClick={handleRequestApproval} disabled={busy}>
                  <ShieldAlert className="h-3.5 w-3.5 mr-1.5" /> Request approval
                </Button>
              </div>
            </div>
          </RoleGate>
        )}

        {savedNotice && (
          <p className="text-xs text-emerald-700 dark:text-emerald-400">{savedNotice}</p>
        )}
      </div>
    </div>
  );
}
