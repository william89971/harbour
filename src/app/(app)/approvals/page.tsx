"use client";

/**
 * Approval Inbox — dedicated fast-review surface for autonomy approval
 * requests. Reuses the existing GET/POST endpoints; the page is the only
 * new surface. Pending cards expose Approve / Reject with optional
 * comments. Resolved cards are read-only with the original comment.
 */

import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Inbox, CheckCircle2, XCircle, ShieldAlert, Bot, Clock } from "lucide-react";
import { RoleGate } from "@/components/app/role-gate";
import { EmptyState } from "@/components/app/empty-state";
import { SectionHeader } from "@/components/app/section-header";
import { timeAgo } from "@/lib/time";

type ApprovalRow = {
  id: string;
  source_type: "run" | "workflow_run" | "workflow_step" | "tool_call" | "cost";
  source_id: string;
  requested_by_agent_id: string | null;
  requested_by_agent_name: string | null;
  action_type: string;
  risk_level: "low" | "medium" | "high" | "critical";
  reason: string | null;
  payload_json: string | null;
  status: "pending" | "approved" | "rejected" | "expired";
  approval_comment: string | null;
  approved_by_user_id: string | null;
  created_at: number;
  resolved_at: number | null;
};

const FILTERS = [
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "all", label: "All" },
] as const;

function riskClass(risk: ApprovalRow["risk_level"]): string {
  switch (risk) {
    case "critical": return "bg-red-500/10 text-red-700 dark:text-red-400";
    case "high":     return "bg-amber-500/10 text-amber-700 dark:text-amber-400";
    case "medium":   return "bg-blue-500/10 text-blue-700 dark:text-blue-400";
    default:         return "bg-muted text-muted-foreground";
  }
}

function sourceHref(row: ApprovalRow): { href: string; label: string } | null {
  if (row.source_type === "run" || row.source_type === "tool_call" || row.source_type === "cost") {
    return { href: `/runs/${row.source_id}`, label: `Open run` };
  }
  if (row.source_type === "workflow_run") {
    return { href: `/workflow-runs/${row.source_id}`, label: `Open workflow run` };
  }
  return null;
}

function prettyPayload(raw: string | null): string | null {
  if (!raw) return null;
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export default function ApprovalsPage() {
  const qc = useQueryClient();
  const [filterId, setFilterId] = useState<(typeof FILTERS)[number]["id"]>("pending");
  const [comments, setComments] = useState<Record<string, string>>({});

  const statusParam = filterId === "all" ? "" : `?status=${filterId}`;
  const { data, isLoading } = useQuery({
    queryKey: ["approvals", filterId],
    queryFn: async () => {
      const res = await fetch(`/api/autonomy/approvals${statusParam}`);
      if (!res.ok) throw new Error("Failed to load approvals");
      return res.json() as Promise<{ approvals: ApprovalRow[] }>;
    },
    refetchInterval: 10_000,
  });

  const decide = useMutation({
    mutationFn: async ({ id, action, comment }: { id: string; action: "approve" | "reject"; comment?: string }) => {
      const r = await fetch(`/api/autonomy/approvals/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment }),
      });
      if (r.status === 409) return { conflict: true } as const;
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || "request failed");
      }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["approvals"] });
      qc.invalidateQueries({ queryKey: ["approvals-count"] });
      qc.invalidateQueries({ queryKey: ["today"] });
    },
  });

  const rows = data?.approvals ?? [];
  const pendingCount = rows.filter(r => r.status === "pending").length;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Inbox className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Review autonomy gates from agents and workflows.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1 text-sm">
        {FILTERS.map(f => (
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
            {f.id === "pending" && pendingCount > 0 && (
              <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground py-12 text-center">Loading...</div>
      ) : rows.length === 0 ? (
        <EmptyState large icon={<Inbox className="h-10 w-10 text-muted-foreground/40" />}>
          {filterId === "pending" ? "Nothing waiting on you." : "No approvals match this filter."}
        </EmptyState>
      ) : (
        <section>
          <SectionHeader count={rows.length}>{FILTERS.find(f => f.id === filterId)?.label}</SectionHeader>
          <div className="space-y-3">
            {rows.map(row => {
              const src = sourceHref(row);
              const pending = row.status === "pending";
              const payload = prettyPayload(row.payload_json);
              return (
                <div
                  key={row.id}
                  className={`rounded-lg border p-4 space-y-3 ${pending ? "border-amber-500/40 bg-amber-500/[0.02]" : ""}`}
                >
                  <div className="flex items-start gap-3">
                    <ShieldAlert className={`h-4 w-4 mt-0.5 shrink-0 ${pending ? "text-amber-600" : "text-muted-foreground"}`} />
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{row.action_type.replace(/_/g, " ")}</span>
                        <Badge variant="secondary" className={`text-[10px] ${riskClass(row.risk_level)}`}>
                          {row.risk_level} risk
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">{row.source_type.replace(/_/g, " ")}</Badge>
                        {row.status === "approved" && <Badge className="text-[10px]" variant="default">approved</Badge>}
                        {row.status === "rejected" && <Badge className="text-[10px]" variant="destructive">rejected</Badge>}
                        {row.status === "expired" && <Badge className="text-[10px]" variant="secondary">expired</Badge>}
                        <span className="text-xs text-muted-foreground ml-auto inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" /> {timeAgo(row.created_at)}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground inline-flex items-center gap-3 flex-wrap">
                        {row.requested_by_agent_name && (
                          <span className="inline-flex items-center gap-1">
                            <Bot className="h-3 w-3" /> Requested by {row.requested_by_agent_name}
                          </span>
                        )}
                        {src && (
                          <Link href={src.href} className="text-primary hover:underline">
                            {src.label} →
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>

                  {row.reason && (
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap pl-7">{row.reason}</p>
                  )}

                  {payload && (
                    <details className="pl-7 text-xs">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
                        Payload preview
                      </summary>
                      <pre className="mt-2 rounded-md bg-muted p-2 overflow-auto text-[11px] leading-relaxed">{payload}</pre>
                    </details>
                  )}

                  {pending && (
                    <RoleGate action="approveAutonomy">
                      <div className="pl-7 space-y-2">
                        <Textarea
                          rows={2}
                          placeholder="Optional comment (used as feedback for rejected = request changes)…"
                          value={comments[row.id] ?? ""}
                          onChange={e => setComments(c => ({ ...c, [row.id]: e.target.value }))}
                          className="text-sm"
                        />
                        <div className="flex gap-2 flex-wrap">
                          <Button
                            size="sm"
                            disabled={decide.isPending}
                            onClick={() => decide.mutate({ id: row.id, action: "approve", comment: comments[row.id]?.trim() || undefined })}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={decide.isPending}
                            onClick={() => decide.mutate({ id: row.id, action: "reject", comment: comments[row.id]?.trim() || undefined })}
                          >
                            <XCircle className="h-3.5 w-3.5 mr-1.5" /> Reject / Request changes
                          </Button>
                        </div>
                      </div>
                    </RoleGate>
                  )}

                  {!pending && row.approval_comment && (
                    <div className="pl-7 text-xs italic text-muted-foreground">
                      Comment: {row.approval_comment}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
