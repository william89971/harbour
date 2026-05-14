"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { GitBranch, GitCommit, AlertTriangle, GitPullRequest, CircleDot, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SectionHeader } from "@/components/app/section-header";
import { EmptyState } from "@/components/app/empty-state";
import { timeAgo } from "@/lib/time";

type Commit = { sha: string; message: string; author: string; html_url: string; date: string };
type Issue = { number: number; title: string; user: string; html_url: string; created_at: string };
type Pull = { number: number; title: string; user: string; html_url: string; draft: boolean; created_at: string };
type Repo = { full_name: string; default_branch: string; html_url: string; stargazers_count: number; open_issues_count: number; updated_at: string };

type Summary = {
  configured: boolean;
  repo: Repo | null;
  commits: Commit[];
  issues: Issue[];
  pullRequests: Pull[];
  staleDays: number | null;
  fetchedAt: number;
  errors?: string[];
};

function isoToTs(iso: string): number {
  const t = Date.parse(iso);
  return isNaN(t) ? 0 : Math.floor(t / 1000);
}

export default function GitHubIntegrationPage() {
  const { data, isLoading } = useQuery<Summary>({
    queryKey: ["github-summary"],
    queryFn: async () => {
      const res = await fetch("/api/integrations/github/summary");
      if (!res.ok) throw new Error("Failed to load GitHub summary");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  if (isLoading || !data) {
    return <div className="text-sm text-muted-foreground py-12 text-center">Loading...</div>;
  }

  if (!data.configured) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <GitBranch className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold tracking-tight">GitHub</h1>
        </div>
        <EmptyState large icon={<GitBranch className="h-10 w-10 text-muted-foreground/40" />}>
          GitHub is not configured.{" "}
          <Link href="/settings" className="text-primary underline">Open Settings</Link>
          {" "}to set the repository and token env var.
        </EmptyState>
      </div>
    );
  }

  const stale = data.staleDays !== null && data.staleDays > 7;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <GitBranch className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold tracking-tight">{data.repo?.full_name ?? "GitHub"}</h1>
        {stale && (
          <Badge variant="destructive" className="text-[10px]">
            Idle for {data.staleDays} days
          </Badge>
        )}
        {data.repo && (
          <a
            href={data.repo.html_url}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1"
          >
            View on GitHub <ExternalLink className="h-3 w-3" />
          </a>
        )}
        <span className="text-xs text-muted-foreground ml-auto">Fetched {timeAgo(data.fetchedAt)}</span>
      </div>

      {data.errors && data.errors.length > 0 && (
        <section className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs space-y-1">
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span className="font-medium">Some data could not be fetched</span>
          </div>
          <ul className="list-disc pl-5 text-muted-foreground space-y-0.5">
            {data.errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section>
          <SectionHeader count={data.commits.length}>Recent commits</SectionHeader>
          {data.commits.length === 0 ? (
            <EmptyState>No commits.</EmptyState>
          ) : (
            <div className="space-y-2">
              {data.commits.map(c => (
                <a
                  key={c.sha}
                  href={c.html_url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-start gap-3 rounded-lg border p-3 hover:bg-accent/50 transition-colors"
                >
                  <GitCommit className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{c.message || "(no message)"}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      <span className="font-mono">{c.sha.slice(0, 7)}</span> · {c.author} · {timeAgo(isoToTs(c.date))}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          )}
        </section>

        <section>
          <SectionHeader count={data.issues.length}>Open issues</SectionHeader>
          {data.issues.length === 0 ? (
            <EmptyState>No open issues.</EmptyState>
          ) : (
            <div className="space-y-2">
              {data.issues.map(i => (
                <a
                  key={i.number}
                  href={i.html_url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-start gap-3 rounded-lg border p-3 hover:bg-accent/50 transition-colors"
                >
                  <CircleDot className="h-4 w-4 mt-0.5 text-emerald-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">#{i.number} {i.title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      by {i.user} · {timeAgo(isoToTs(i.created_at))}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          )}
        </section>

        <section>
          <SectionHeader count={data.pullRequests.length}>Open PRs</SectionHeader>
          {data.pullRequests.length === 0 ? (
            <EmptyState>No open pull requests.</EmptyState>
          ) : (
            <div className="space-y-2">
              {data.pullRequests.map(p => (
                <a
                  key={p.number}
                  href={p.html_url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-start gap-3 rounded-lg border p-3 hover:bg-accent/50 transition-colors"
                >
                  <GitPullRequest className={`h-4 w-4 mt-0.5 shrink-0 ${p.draft ? "text-muted-foreground" : "text-emerald-600"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">#{p.number} {p.title}</span>
                      {p.draft && <Badge variant="secondary" className="text-[10px]">draft</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      by {p.user} · {timeAgo(isoToTs(p.created_at))}
                    </div>
                  </div>
                </a>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
