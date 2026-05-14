"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Gauge, ThumbsUp, ThumbsDown } from "lucide-react";
import { SectionHeader } from "@/components/app/section-header";
import { EmptyState } from "@/components/app/empty-state";
import { BackLink } from "@/components/app/back-link";
import { timeAgo } from "@/lib/time";

type Scorecard = {
  agent_id: string;
  agent_name: string;
  total_runs: number;
  completed_runs: number;
  failed_runs: number;
  killed_runs: number;
  waiting_runs: number;
  success_rate: number | null;
  failure_rate: number | null;
  total_cost_usd: number;
  feedback_useful: number;
  feedback_not_useful: number;
  usefulness_ratio: number | null;
  last_run_at: number | null;
  flags: { failing: boolean; low_usefulness: boolean; high_cost: boolean; has_waiting: boolean };
};

const FILTERS = [
  { id: "all", label: "All" },
  { id: "failing", label: "Failing" },
  { id: "low_usefulness", label: "Low usefulness" },
  { id: "high_cost", label: "High cost" },
] as const;

function pct(v: number | null) { return v === null ? "—" : `${Math.round(v * 100)}%`; }
function money(v: number) { return `$${v.toFixed(2)}`; }

export default function AgentScorecardsPage() {
  const [filterId, setFilterId] = useState<(typeof FILTERS)[number]["id"]>("all");

  const { data: cards = [], isLoading } = useQuery<Scorecard[]>({
    queryKey: ["agent-scorecards"],
    queryFn: async () => {
      const r = await fetch("/api/agents/scorecards");
      if (!r.ok) return [];
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const filtered = filterId === "all"
    ? cards
    : cards.filter(c => (c.flags as unknown as Record<string, boolean>)[filterId]);

  return (
    <div className="space-y-6">
      <BackLink href="/agents" label="Back to Agents" />
      <div className="flex items-center gap-3 flex-wrap">
        <Gauge className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold tracking-tight">Agent scorecards</h1>
        <p className="text-sm text-muted-foreground">Reliability, cost, approval behavior, and operator usefulness ratings per agent.</p>
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
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground py-12 text-center">Loading...</div>
      ) : filtered.length === 0 ? (
        <EmptyState large icon={<Gauge className="h-10 w-10 text-muted-foreground/40" />}>
          {filterId === "all" ? "No agents yet." : "No agents match this filter."}
        </EmptyState>
      ) : (
        <section>
          <SectionHeader count={filtered.length}>{FILTERS.find(f => f.id === filterId)?.label}</SectionHeader>
          <div className="overflow-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left p-3">Agent</th>
                  <th className="text-right p-3">Runs</th>
                  <th className="text-right p-3">Success</th>
                  <th className="text-right p-3">Failed</th>
                  <th className="text-right p-3">Cost</th>
                  <th className="text-right p-3"><ThumbsUp className="h-3.5 w-3.5 inline" /> / <ThumbsDown className="h-3.5 w-3.5 inline" /></th>
                  <th className="text-left p-3">Last run</th>
                  <th className="text-left p-3">Flags</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => (
                  <tr key={c.agent_id} className="border-t hover:bg-accent/40">
                    <td className="p-3">
                      <Link href={`/agents/${c.agent_id}`} className="font-medium hover:underline">{c.agent_name}</Link>
                    </td>
                    <td className="p-3 text-right">{c.total_runs}</td>
                    <td className="p-3 text-right">{pct(c.success_rate)}</td>
                    <td className="p-3 text-right">{c.failed_runs + c.killed_runs}</td>
                    <td className="p-3 text-right">{money(c.total_cost_usd)}</td>
                    <td className="p-3 text-right">
                      <span className="text-emerald-700 dark:text-emerald-400">{c.feedback_useful}</span>
                      <span className="text-muted-foreground"> / </span>
                      <span className="text-rose-700 dark:text-rose-400">{c.feedback_not_useful}</span>
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">{c.last_run_at ? timeAgo(c.last_run_at) : "never"}</td>
                    <td className="p-3 space-x-1">
                      {c.flags.failing && <Badge variant="destructive" className="text-[10px]">failing</Badge>}
                      {c.flags.low_usefulness && <Badge variant="destructive" className="text-[10px]">low usefulness</Badge>}
                      {c.flags.high_cost && <Badge variant="secondary" className="text-[10px]">high cost</Badge>}
                      {c.flags.has_waiting && <Badge variant="secondary" className="text-[10px]">waiting</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
