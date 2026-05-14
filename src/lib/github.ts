/**
 * GitHub integration — read-only client.
 *
 * Wraps the GitHub REST API with fetch. No mutations: only repo metadata,
 * recent commits, open issues, open pull requests. The PAT lives in the
 * env_vars table (encrypted); this module reads it server-side only.
 */

import { getSettingAsync } from "./db/settings";
import { getDecryptedEnvVarValueByNameAsync, getEnvVarByNameAsync } from "./db/env-vars";

export type GitHubConfig = {
  owner: string;
  repo: string;
  defaultBranch: string;
  tokenEnvVarName: string;
  /** Plaintext token, server-side only. Never serialized. */
  token: string | null;
};

export type GitHubConfigPublic = {
  owner: string;
  repo: string;
  defaultBranch: string;
  tokenEnvVarName: string;
  tokenConfigured: boolean;
};

export type GitHubCommit = {
  sha: string;
  message: string;
  author: string;
  html_url: string;
  date: string;
};

export type GitHubIssue = {
  number: number;
  title: string;
  user: string;
  html_url: string;
  created_at: string;
};

export type GitHubPullRequest = {
  number: number;
  title: string;
  user: string;
  html_url: string;
  draft: boolean;
  created_at: string;
};

export type GitHubRepoMeta = {
  full_name: string;
  default_branch: string;
  html_url: string;
  stargazers_count: number;
  open_issues_count: number;
  updated_at: string;
};

export type GitHubSummary = {
  configured: boolean;
  repo: GitHubRepoMeta | null;
  commits: GitHubCommit[];
  issues: GitHubIssue[];
  pullRequests: GitHubPullRequest[];
  staleDays: number | null;
  fetchedAt: number;
  errors?: string[];
};

export const DEFAULT_TOKEN_ENV_VAR_NAME = "GITHUB_TOKEN";
const GITHUB_API_BASE = "https://api.github.com";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export async function getGitHubConfigAsync(): Promise<GitHubConfig | null> {
  const [owner, repo, defaultBranch, tokenEnvVarName] = await Promise.all([
    getSettingAsync("github_owner"),
    getSettingAsync("github_repo"),
    getSettingAsync("github_default_branch"),
    getSettingAsync("github_token_env_var_name"),
  ]);
  if (!owner || !repo) return null;
  const envVarName = tokenEnvVarName || DEFAULT_TOKEN_ENV_VAR_NAME;
  const token = await getDecryptedEnvVarValueByNameAsync(envVarName);
  return {
    owner,
    repo,
    defaultBranch: defaultBranch || "main",
    tokenEnvVarName: envVarName,
    token: token || null,
  };
}

export async function getGitHubPublicConfigAsync(): Promise<GitHubConfigPublic> {
  const [owner, repo, defaultBranch, tokenEnvVarName] = await Promise.all([
    getSettingAsync("github_owner"),
    getSettingAsync("github_repo"),
    getSettingAsync("github_default_branch"),
    getSettingAsync("github_token_env_var_name"),
  ]);
  const envVarName = tokenEnvVarName || DEFAULT_TOKEN_ENV_VAR_NAME;
  const tokenRow = await getEnvVarByNameAsync(envVarName);
  return {
    owner: owner ?? "",
    repo: repo ?? "",
    defaultBranch: defaultBranch ?? "",
    tokenEnvVarName: envVarName,
    tokenConfigured: !!tokenRow,
  };
}

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

function headersFor(cfg: GitHubConfig): HeadersInit {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "harbour-github-integration",
  };
  if (cfg.token) h.Authorization = `Bearer ${cfg.token}`;
  return h;
}

async function get<T>(cfg: GitHubConfig, path: string): Promise<T> {
  const res = await fetch(`${GITHUB_API_BASE}${path}`, { headers: headersFor(cfg) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub ${path} HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchRepoMetadata(cfg: GitHubConfig): Promise<GitHubRepoMeta> {
  type Raw = {
    full_name: string; default_branch: string; html_url: string;
    stargazers_count: number; open_issues_count: number; updated_at: string;
  };
  const raw = await get<Raw>(cfg, `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`);
  return {
    full_name: raw.full_name,
    default_branch: raw.default_branch,
    html_url: raw.html_url,
    stargazers_count: raw.stargazers_count,
    open_issues_count: raw.open_issues_count,
    updated_at: raw.updated_at,
  };
}

export async function fetchRecentCommits(cfg: GitHubConfig, limit = 10): Promise<GitHubCommit[]> {
  type Raw = {
    sha: string;
    html_url: string;
    commit: { message: string; author: { name?: string; date: string } | null };
    author: { login?: string } | null;
  };
  const rows = await get<Raw[]>(
    cfg,
    `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/commits?sha=${encodeURIComponent(cfg.defaultBranch)}&per_page=${Math.max(1, Math.min(limit, 100))}`,
  );
  return rows.map(r => ({
    sha: r.sha,
    message: (r.commit?.message || "").split("\n")[0].slice(0, 200),
    author: r.author?.login || r.commit?.author?.name || "unknown",
    html_url: r.html_url,
    date: r.commit?.author?.date || "",
  }));
}

export async function fetchOpenIssues(cfg: GitHubConfig, limit = 10): Promise<GitHubIssue[]> {
  // GitHub's /issues endpoint returns both issues AND pull requests. Filter
  // out PRs server-side (PRs have a non-null pull_request field).
  type Raw = {
    number: number; title: string; html_url: string; created_at: string;
    user: { login?: string } | null;
    pull_request?: unknown;
  };
  const rows = await get<Raw[]>(
    cfg,
    `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/issues?state=open&per_page=${Math.max(1, Math.min(limit * 2, 100))}`,
  );
  return rows
    .filter(r => !r.pull_request)
    .slice(0, limit)
    .map(r => ({
      number: r.number,
      title: r.title,
      user: r.user?.login || "unknown",
      html_url: r.html_url,
      created_at: r.created_at,
    }));
}

export async function fetchOpenPullRequests(cfg: GitHubConfig, limit = 10): Promise<GitHubPullRequest[]> {
  type Raw = {
    number: number; title: string; html_url: string; draft: boolean; created_at: string;
    user: { login?: string } | null;
  };
  const rows = await get<Raw[]>(
    cfg,
    `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/pulls?state=open&per_page=${Math.max(1, Math.min(limit, 100))}`,
  );
  return rows.map(r => ({
    number: r.number,
    title: r.title,
    user: r.user?.login || "unknown",
    html_url: r.html_url,
    draft: !!r.draft,
    created_at: r.created_at,
  }));
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export function computeStaleDays(latestCommitIso: string | null | undefined, now: Date = new Date()): number | null {
  if (!latestCommitIso) return null;
  const t = Date.parse(latestCommitIso);
  if (isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
}

export async function fetchGitHubSummary(cfg: GitHubConfig): Promise<GitHubSummary> {
  const errors: string[] = [];
  const [metaR, commitsR, issuesR, prsR] = await Promise.allSettled([
    fetchRepoMetadata(cfg),
    fetchRecentCommits(cfg, 10),
    fetchOpenIssues(cfg, 10),
    fetchOpenPullRequests(cfg, 10),
  ]);
  const repo = metaR.status === "fulfilled" ? metaR.value : null;
  if (metaR.status === "rejected") errors.push(`metadata: ${(metaR.reason as Error).message}`);

  const commits = commitsR.status === "fulfilled" ? commitsR.value : [];
  if (commitsR.status === "rejected") errors.push(`commits: ${(commitsR.reason as Error).message}`);

  const issues = issuesR.status === "fulfilled" ? issuesR.value : [];
  if (issuesR.status === "rejected") errors.push(`issues: ${(issuesR.reason as Error).message}`);

  const pullRequests = prsR.status === "fulfilled" ? prsR.value : [];
  if (prsR.status === "rejected") errors.push(`pullRequests: ${(prsR.reason as Error).message}`);

  const staleDays = commits.length > 0 ? computeStaleDays(commits[0].date) : null;

  return {
    configured: true,
    repo,
    commits,
    issues,
    pullRequests,
    staleDays,
    fetchedAt: Math.floor(Date.now() / 1000),
    ...(errors.length > 0 ? { errors } : {}),
  };
}

/** High-level entry: reads config + token, calls summary. Returns
 *  `{ configured: false, ... }` when settings/token aren't set up. */
export async function getGitHubSummaryAsync(): Promise<GitHubSummary> {
  const cfg = await getGitHubConfigAsync();
  const empty: GitHubSummary = {
    configured: false,
    repo: null,
    commits: [],
    issues: [],
    pullRequests: [],
    staleDays: null,
    fetchedAt: Math.floor(Date.now() / 1000),
  };
  if (!cfg) return empty;
  if (!cfg.token) return { ...empty, errors: [`token env var "${cfg.tokenEnvVarName}" is not set`] };
  return fetchGitHubSummary(cfg);
}
