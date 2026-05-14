"use client";

/**
 * Renders an agent's scorecard: reliability + cost + approvals + usefulness.
 * Fetched from GET /api/agents/:id/scorecard.
 */

import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Gauge, DollarSign, ShieldAlert, ThumbsUp, ThumbsDown, Minus, Clock, AlertTriangle } from "lucide-react";
import { timeAgo } from "@/lib/time";

type Scorecard = {
  agent_id: string;
  agent_name: string;
  total_runs: number;
  completed_runs: number;
  failed_runs: number;
  killed_runs: number;
  waiting_runs: number;
  running_runs: number;
  success_rate: number | null;
  failure_rate: number | null;
  avg_runtime_seconds: number | null;
  total_cost_usd: number;
  avg_cost_usd: number | null;
  approvals_requested: number;
  approvals_approved: number;
  approvals_rejected: number;
  feedback_useful: number;
  feedback_not_useful: number;
  feedback_neutral: number;
  usefulness_ratio: number | null;
  last_run_at: number | null;
  last_successful_run_at: number | null;
  flags: { failing: boolean; low_usefulness: boolean; high_cost: boolean; has_waiting: boolean };
};

function pct(v: number | null): string {
  if (v === null) return "—";
  return `${Math.round(v * 100)}%`;
}

function money(v: number): string {
  if (!v) return "$0.00";
  return `$${v.toFixed(2)}`;
}

function minutes(s: number | null): string {
  if (s === null) return "—";
  if (s < 60) return `${Math.round(s)}s`;
  return `${(s / 60).toFixed(1)}m`;
}

export function AgentScorecardCard({ agentId }: { agentId: string }) {
  const { data: card, isLoading } = useQuery<Scorecard | null>({
    queryKey: ["agent-scorecard", agentId],
    queryFn: async () => {
      const r = await fetch(`/api/agents/${agentId}/scorecard`);
      if (!r.ok) return null;
      return r.json();
    },
    refetchInterval: 30_000,
  });

  if (isLoading || !card) return null;

  const flags = card.flags;
  const anyFlag = flags.failing || flags.low_usefulness || flags.high_cost || flags.has_waiting;

  return (
    <section className="rounded-lg border p-4 space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Gauge className="h-4 w-4 text-primary" />
        <span className="text-base font-medium">Scorecard</span>
        {anyFlag && (
          <div className="flex items-center gap-1 flex-wrap ml-auto">
            {flags.failing && <Badge variant="destructive" className="text-[10px]">failing</Badge>}
            {flags.low_usefulness && <Badge variant="destructive" className="text-[10px]">low usefulness</Badge>}
            {flags.high_cost && <Badge variant="secondary" className="text-[10px]">high cost</Badge>}
            {flags.has_waiting && <Badge variant="secondary" className="text-[10px]">waiting</Badge>}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Reliability */}
        <div className="rounded-md border p-3 space-y-1">
          <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
            <Gauge className="h-3.5 w-3.5" /> Reliability
          </div>
          <div className="text-2xl font-semibold tracking-tight">{pct(card.success_rate)}</div>
          <div className="text-[11px] text-muted-foreground">
            {card.completed_runs} done · {card.failed_runs} failed · {card.killed_runs} killed
          </div>
          <div className="text-[11px] text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" /> last run {card.last_run_at ? timeAgo(card.last_run_at) : "never"}
          </div>
          {card.last_successful_run_at && (
            <div className="text-[11px] text-muted-foreground">
              last success {timeAgo(card.last_successful_run_at)}
            </div>
          )}
        </div>

        {/* Cost */}
        <div className="rounded-md border p-3 space-y-1">
          <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
            <DollarSign className="h-3.5 w-3.5" /> Cost
          </div>
          <div className="text-2xl font-semibold tracking-tight">{money(card.total_cost_usd)}</div>
          <div className="text-[11px] text-muted-foreground">
            avg {card.avg_cost_usd !== null ? money(card.avg_cost_usd) : "—"} / run
          </div>
          <div className="text-[11px] text-muted-foreground">
            avg runtime {minutes(card.avg_runtime_seconds)}
          </div>
        </div>

        {/* Approvals */}
        <div className="rounded-md border p-3 space-y-1">
          <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
            <ShieldAlert className="h-3.5 w-3.5" /> Approvals
          </div>
          <div className="text-2xl font-semibold tracking-tight">{card.approvals_requested}</div>
          <div className="text-[11px] text-muted-foreground">
            {card.approvals_approved} approved · {card.approvals_rejected} rejected
          </div>
        </div>

        {/* Usefulness */}
        <div className="rounded-md border p-3 space-y-1">
          <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
            <ThumbsUp className="h-3.5 w-3.5" /> Usefulness
          </div>
          <div className="text-2xl font-semibold tracking-tight">{pct(card.usefulness_ratio)}</div>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1"><ThumbsUp className="h-3 w-3" />{card.feedback_useful}</span>
            <span className="inline-flex items-center gap-1"><Minus className="h-3 w-3" />{card.feedback_neutral}</span>
            <span className="inline-flex items-center gap-1"><ThumbsDown className="h-3 w-3" />{card.feedback_not_useful}</span>
          </div>
        </div>
      </div>

      {card.total_runs === 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5" /> No runs yet — metrics populate as the agent works.
        </div>
      )}
    </section>
  );
}
