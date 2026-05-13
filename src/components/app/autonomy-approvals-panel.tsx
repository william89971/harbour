"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { RoleGate } from "@/components/app/role-gate";
import { CheckCircle2, XCircle, ShieldAlert } from "lucide-react";
import Link from "next/link";

type ApprovalRow = {
  id: string;
  source_type: "run" | "workflow_run" | "workflow_step" | "tool_call" | "cost";
  source_id: string;
  action_type: string;
  risk_level: "low" | "medium" | "high" | "critical";
  reason: string | null;
  status: "pending" | "approved" | "rejected" | "expired";
  approval_comment: string | null;
  created_at: number;
};

type Filter = {
  status?: "pending" | "approved" | "rejected" | "expired";
  source_type?: ApprovalRow["source_type"];
  source_id?: string;
  limit?: number;
};

function buildQs(filter: Filter): string {
  const sp = new URLSearchParams();
  if (filter.status) sp.set("status", filter.status);
  if (filter.source_type) sp.set("source_type", filter.source_type);
  if (filter.source_id) sp.set("source_id", filter.source_id);
  if (filter.limit) sp.set("limit", String(filter.limit));
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

function riskColor(risk: ApprovalRow["risk_level"]): string {
  switch (risk) {
    case "critical": return "bg-red-500/10 text-red-700 dark:text-red-400";
    case "high":     return "bg-amber-500/10 text-amber-700 dark:text-amber-400";
    case "medium":   return "bg-blue-500/10 text-blue-700 dark:text-blue-400";
    default:         return "bg-muted text-muted-foreground";
  }
}

function sourceHref(row: ApprovalRow): string | null {
  if (row.source_type === "run" || row.source_type === "tool_call" || row.source_type === "cost") {
    return `/runs/${row.source_id}`;
  }
  if (row.source_type === "workflow_run") {
    return `/workflow-runs/${row.source_id}`;
  }
  return null;
}

export function AutonomyApprovalsPanel({ filter, emptyHint }: { filter: Filter; emptyHint?: string }) {
  const qc = useQueryClient();
  const [comments, setComments] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["autonomy-approvals", filter],
    queryFn: async () => {
      const r = await fetch(`/api/autonomy/approvals${buildQs(filter)}`);
      if (!r.ok) throw new Error("failed to load approvals");
      return r.json() as Promise<{ approvals: ApprovalRow[] }>;
    },
    refetchInterval: 15_000,
  });

  const decide = useMutation({
    mutationFn: async ({ id, action, comment }: { id: string; action: "approve" | "reject"; comment?: string }) => {
      const r = await fetch(`/api/autonomy/approvals/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment }),
      });
      if (r.status === 409) {
        // Already resolved by someone else (race). Refresh silently.
        return { conflict: true } as const;
      }
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || "request failed");
      }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["autonomy-approvals"] });
    },
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading approvals…</p>;
  const rows = data?.approvals ?? [];
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {emptyHint ?? "No pending approvals."}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const href = sourceHref(row);
        const pending = row.status === "pending";
        return (
          <div key={row.id} className="rounded-md border bg-card p-3 text-sm space-y-2">
            <div className="flex items-start gap-2 flex-wrap">
              <ShieldAlert className="h-4 w-4 mt-0.5 text-amber-600 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{row.action_type}</span>
                  <Badge className={riskColor(row.risk_level)} variant="secondary">{row.risk_level}</Badge>
                  <Badge variant="outline">{row.source_type}</Badge>
                  {!pending && (
                    <Badge variant={row.status === "approved" ? "default" : "secondary"}>{row.status}</Badge>
                  )}
                </div>
                {row.reason && (
                  <p className="text-xs text-muted-foreground mt-1">{row.reason}</p>
                )}
                {href && (
                  <Link className="text-xs text-primary underline" href={href}>
                    open {row.source_type}
                  </Link>
                )}
              </div>
            </div>
            {pending && (
              <RoleGate action="approveAutonomy">
                <Textarea
                  placeholder="Optional comment…"
                  className="text-xs min-h-[3rem]"
                  value={comments[row.id] ?? ""}
                  onChange={e => setComments(c => ({ ...c, [row.id]: e.target.value }))}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ id: row.id, action: "approve", comment: comments[row.id]?.trim() || undefined })}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ id: row.id, action: "reject", comment: comments[row.id]?.trim() || undefined })}
                  >
                    <XCircle className="h-3.5 w-3.5 mr-1.5" /> Reject
                  </Button>
                </div>
              </RoleGate>
            )}
          </div>
        );
      })}
    </div>
  );
}
