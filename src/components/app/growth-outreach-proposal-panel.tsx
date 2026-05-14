"use client";

/**
 * Renders the editable outreach-proposal UI for a Growth Outreach Loop run
 * whose latest step activity contains a fenced ```json proposal``` block
 * with `"source": "growth-outreach-loop"`. Each row is editable and can be
 * selectively saved as an outreach_drafts row (status: draft).
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Send, Save, Sparkles } from "lucide-react";
import { RoleGate } from "@/components/app/role-gate";

type ProposedDraft = {
  subject: string;
  body: string;
  contact_name?: string | null;
  contact_email?: string | null;
  company_name?: string | null;
};

type Proposal = {
  source: string;
  drafts: ProposedDraft[];
};

type Activity = { content: string | null };
type RunDetail = { activity?: Activity[] };

type Contact = { id: string; name: string; email: string | null };
type Company = { id: string; name: string };

export function extractProposal(activity: Activity[] | undefined): Proposal | null {
  if (!activity) return null;
  const fence = /```json\s*proposal\s*\n([\s\S]*?)```/i;
  for (let i = activity.length - 1; i >= 0; i--) {
    const content = activity[i]?.content;
    if (!content) continue;
    const m = fence.exec(content);
    if (!m) continue;
    try {
      const parsed = JSON.parse(m[1]);
      if (parsed?.source === "growth-outreach-loop" && Array.isArray(parsed?.drafts)) {
        return parsed as Proposal;
      }
    } catch { /* keep scanning */ }
  }
  return null;
}

function matchContact(name: string | null | undefined, email: string | null | undefined, contacts: Contact[]): string | null {
  if (!contacts.length) return null;
  if (email) {
    const byEmail = contacts.find(c => c.email && c.email.toLowerCase() === email.toLowerCase());
    if (byEmail) return byEmail.id;
  }
  if (name) {
    const byName = contacts.find(c => c.name.toLowerCase() === name.toLowerCase());
    if (byName) return byName.id;
  }
  return null;
}

function matchCompany(name: string | null | undefined, companies: Company[]): string | null {
  if (!name || !companies.length) return null;
  return companies.find(c => c.name.toLowerCase() === name.toLowerCase())?.id ?? null;
}

export function GrowthOutreachProposalPanel({
  workflowRunId,
  underlyingRunId,
}: {
  workflowRunId: string;
  underlyingRunId: string;
}) {
  const qc = useQueryClient();

  const { data: run } = useQuery<RunDetail | null>({
    queryKey: ["run-with-activity", underlyingRunId],
    queryFn: async () => {
      const r = await fetch(`/api/runs/${underlyingRunId}`);
      if (!r.ok) return null;
      return r.json();
    },
  });

  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ["contacts", "for-outreach-panel"],
    queryFn: async () => (await fetch("/api/contacts")).json().catch(() => []),
  });
  const { data: companies = [] } = useQuery<Company[]>({
    queryKey: ["companies", "for-outreach-panel"],
    queryFn: async () => (await fetch("/api/companies")).json().catch(() => []),
  });

  const proposal = useMemo(() => extractProposal(run?.activity), [run]);

  if (!proposal) return null;

  return (
    <ProposalForm
      key={underlyingRunId}
      workflowRunId={workflowRunId}
      proposal={proposal}
      contacts={contacts}
      companies={companies}
      qc={qc}
    />
  );
}

function ProposalForm({
  workflowRunId, proposal, contacts, companies, qc,
}: {
  workflowRunId: string;
  proposal: Proposal;
  contacts: Contact[];
  companies: Company[];
  qc: ReturnType<typeof useQueryClient>;
}) {
  type Draft = ProposedDraft & {
    _selected: boolean;
    contact_id: string;
    company_id: string;
  };

  const [drafts, setDrafts] = useState<Draft[]>(() =>
    proposal.drafts.map(d => ({
      _selected: true,
      subject: d.subject ?? "",
      body: d.body ?? "",
      contact_name: d.contact_name ?? null,
      contact_email: d.contact_email ?? null,
      company_name: d.company_name ?? null,
      contact_id: matchContact(d.contact_name, d.contact_email, contacts) ?? "",
      company_id: matchCompany(d.company_name, companies) ?? "",
    })),
  );
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<{ created: number } | null>(null);

  const selectedCount = drafts.filter(d => d._selected).length;

  function update(idx: number, patch: Partial<Draft>) {
    setDrafts(prev => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const selected = drafts.filter(d => d._selected);
      let created = 0;
      for (const d of selected) {
        const r = await fetch("/api/outreach", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject: d.subject.trim(),
            body: d.body,
            contact_id: d.contact_id || null,
            company_id: d.company_id || null,
          }),
        });
        if (r.ok) created++;
      }
      // Approve the workflow run to close the gate.
      try {
        await fetch(`/api/workflow-runs/${workflowRunId}/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ comment: `Saved ${created} outreach draft${created === 1 ? "" : "s"}.` }),
        });
      } catch { /* race-tolerant */ }
      setDone({ created });
      qc.invalidateQueries({ queryKey: ["workflow-runs", workflowRunId] });
      qc.invalidateQueries({ queryKey: ["outreach"] });
      qc.invalidateQueries({ queryKey: ["today"] });
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <section className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-2">
        <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
          <Sparkles className="h-4 w-4" />
          <span className="text-sm font-medium">Saved {done.created} outreach draft{done.created === 1 ? "" : "s"}.</span>
          <Link href="/outreach" className="ml-auto text-xs underline">Open Outreach →</Link>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Send className="h-4 w-4 text-primary" />
        <p className="text-sm font-medium">Proposed outreach drafts</p>
        <Badge variant="secondary" className="text-[10px]">{drafts.length}</Badge>
      </div>

      <div className="space-y-3">
        {drafts.map((d, i) => (
          <div key={i} className="rounded-md border bg-background p-3 space-y-2">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={d._selected}
                onChange={e => update(i, { _selected: e.target.checked })}
                className="mt-1"
              />
              <Input
                value={d.subject}
                onChange={e => update(i, { subject: e.target.value })}
                disabled={!d._selected}
                placeholder="Subject"
              />
            </div>
            <div className="pl-6 grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Contact</Label>
                <select
                  value={d.contact_id}
                  onChange={e => update(i, { contact_id: e.target.value })}
                  disabled={!d._selected}
                  className="w-full rounded-md border bg-background px-2 py-1.5 text-xs disabled:opacity-50"
                >
                  <option value="">— pick / leave blank —</option>
                  {contacts.map(c => (
                    <option key={c.id} value={c.id}>{c.name}{c.email ? ` <${c.email}>` : ""}</option>
                  ))}
                </select>
                {!d.contact_id && (d.contact_name || d.contact_email) && (
                  <p className="text-[10px] text-muted-foreground">
                    Proposed: {d.contact_name ?? ""} {d.contact_email ? `<${d.contact_email}>` : ""} (no match — leave blank or create the contact first)
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Company</Label>
                <select
                  value={d.company_id}
                  onChange={e => update(i, { company_id: e.target.value })}
                  disabled={!d._selected}
                  className="w-full rounded-md border bg-background px-2 py-1.5 text-xs disabled:opacity-50"
                >
                  <option value="">— pick / leave blank —</option>
                  {companies.map(co => <option key={co.id} value={co.id}>{co.name}</option>)}
                </select>
              </div>
            </div>
            <div className="pl-6 space-y-1">
              <Label className="text-xs">Body</Label>
              <Textarea
                value={d.body}
                onChange={e => update(i, { body: e.target.value })}
                disabled={!d._selected}
                rows={6}
                className="text-sm"
              />
            </div>
          </div>
        ))}
      </div>

      <RoleGate action="mutateOutreach">
        <div className="flex items-center gap-2 pt-1">
          <Button onClick={handleSave} disabled={saving || selectedCount === 0}>
            <Save className="h-4 w-4 mr-1.5" />
            {saving ? "Saving..." : `Save & approve (${selectedCount} draft${selectedCount === 1 ? "" : "s"})`}
          </Button>
          <span className="text-xs text-muted-foreground">
            New outreach rows start as <em>draft</em>. Request approval per row in <Link href="/outreach" className="underline">Outreach</Link>.
          </span>
        </div>
      </RoleGate>
    </section>
  );
}
