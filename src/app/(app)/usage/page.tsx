"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { DollarSign, Bot, Briefcase, Cpu } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { useProjectFilter, useActiveProjectId } from "@/lib/hooks/use-project-filter";

type Breakdown = { provider: string; model: string | null; total_cost_usd: number; input_tokens: number; output_tokens: number; run_count: number };
type AgentCost = { agent_id: string; agent_name: string; total_cost_usd: number; run_count: number };
type JobCost = { job_id: string; job_name: string; total_cost_usd: number; run_count: number };
type Summary = {
  total_cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  run_count: number;
  unknown_pricing_runs: number;
  breakdown: Breakdown[];
  topAgents: AgentCost[];
  topJobs: JobCost[];
};

function fmtUsd(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

function fmtTokens(n: number | null | undefined): string {
  if (!n) return "0";
  return n.toLocaleString();
}

export default function UsagePage() {
  const projectFilter = useProjectFilter();
  const activeProjectId = useActiveProjectId();

  const { data, isLoading } = useQuery<Summary>({
    queryKey: ["usage", "summary", projectFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (activeProjectId) params.set("projectId", activeProjectId);
      const qs = params.toString();
      const res = await fetch(`/api/usage/summary${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error("Failed to load usage");
      return res.json();
    },
    refetchInterval: 10000,
  });

  if (isLoading) return <div className="text-sm text-muted-foreground py-12 text-center">Loading...</div>;
  const summary = data || { total_cost_usd: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, run_count: 0, unknown_pricing_runs: 0, breakdown: [], topAgents: [], topJobs: [] };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Usage</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Estimated AI spend{activeProjectId ? " for this project" : " across all agents"}.
        </p>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><DollarSign className="h-3.5 w-3.5" /> Total spend</div>
          <div className="text-2xl font-semibold mt-1">{fmtUsd(summary.total_cost_usd)}</div>
        </div>
        <div className="rounded-lg border p-4">
          <div className="text-xs text-muted-foreground">Runs tracked</div>
          <div className="text-2xl font-semibold mt-1">{summary.run_count.toLocaleString()}</div>
        </div>
        <div className="rounded-lg border p-4">
          <div className="text-xs text-muted-foreground">Input tokens</div>
          <div className="text-2xl font-semibold mt-1">{fmtTokens(summary.input_tokens)}</div>
        </div>
        <div className="rounded-lg border p-4">
          <div className="text-xs text-muted-foreground">Output tokens</div>
          <div className="text-2xl font-semibold mt-1">{fmtTokens(summary.output_tokens)}</div>
        </div>
      </div>

      {summary.unknown_pricing_runs > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          <span className="text-amber-700 dark:text-amber-400 font-medium">{summary.unknown_pricing_runs}</span>{" "}
          <span className="text-muted-foreground">
            run{summary.unknown_pricing_runs === 1 ? "" : "s"} had no pricing configured — tokens captured but cost not estimated. Update{" "}
            <code className="text-xs">src/lib/ai-pricing.ts</code> to fix.
          </span>
        </div>
      )}

      {/* Breakdown by model */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium">By model</h2>
        {summary.breakdown.length === 0 ? (
          <EmptyState>No usage data yet.</EmptyState>
        ) : (
          <div className="rounded-lg border divide-y">
            {summary.breakdown.map((b, i) => (
              <div key={i} className="flex items-center gap-3 p-3 text-sm">
                <Cpu className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{b.model || "unknown"}</div>
                  <div className="text-xs text-muted-foreground">{b.provider} · {b.run_count} run{b.run_count === 1 ? "" : "s"} · {fmtTokens(b.input_tokens)} in / {fmtTokens(b.output_tokens)} out</div>
                </div>
                <div className="font-mono text-sm">{fmtUsd(b.total_cost_usd)}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Top agents */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Top agents by cost</h2>
        {summary.topAgents.length === 0 ? (
          <EmptyState>No agent usage yet.</EmptyState>
        ) : (
          <div className="rounded-lg border divide-y">
            {summary.topAgents.map(a => (
              <Link key={a.agent_id} href={`/agents/${a.agent_id}`} className="flex items-center gap-3 p-3 text-sm hover:bg-accent/50 transition-colors">
                <Bot className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{a.agent_name}</div>
                  <div className="text-xs text-muted-foreground">{a.run_count} run{a.run_count === 1 ? "" : "s"}</div>
                </div>
                <div className="font-mono text-sm">{fmtUsd(a.total_cost_usd)}</div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Top jobs */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Top jobs by cost</h2>
        {summary.topJobs.length === 0 ? (
          <EmptyState>No job usage yet.</EmptyState>
        ) : (
          <div className="rounded-lg border divide-y">
            {summary.topJobs.map(j => (
              <Link key={j.job_id} href={`/jobs/${j.job_id}`} className="flex items-center gap-3 p-3 text-sm hover:bg-accent/50 transition-colors">
                <Briefcase className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{j.job_name}</div>
                  <div className="text-xs text-muted-foreground">{j.run_count} run{j.run_count === 1 ? "" : "s"}</div>
                </div>
                <div className="font-mono text-sm">{fmtUsd(j.total_cost_usd)}</div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
