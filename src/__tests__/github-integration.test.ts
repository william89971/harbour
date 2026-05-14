/**
 * GitHub integration — config round-trip, summary endpoint with mocked
 * GitHub fetches, and a Today-aggregator assertion that the `github`
 * block lands when configured.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { setDb, resetDb, initializeSchema } from "@/lib/db/schema";
import {
  createUserAsync,
  createSession,
  createEnvVarAsync,
  setSettingAsync,
} from "@/lib/db/queries";
import {
  computeStaleDays,
  fetchGitHubSummary,
  getGitHubConfigAsync,
  getGitHubPublicConfigAsync,
  getGitHubSummaryAsync,
} from "@/lib/github";
import { GET as configGet, PUT as configPut } from "@/app/api/integrations/github/config/route";
import { GET as summaryGet } from "@/app/api/integrations/github/summary/route";
import { GET as todayGet } from "@/app/api/today/route";

function freshDb() {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

beforeEach(() => {
  const db = freshDb();
  setDb(db);
  initializeSchema(db);
});

afterEach(() => {
  resetDb();
  vi.restoreAllMocks();
});

const noCtx = { params: Promise.resolve({} as Record<string, string>) };

async function adminSession(): Promise<string> {
  const u = await createUserAsync("admin@x.com", "test-pw-1!!", "Admin", "admin");
  return createSession(u!.id);
}

function authedReq(url: string, sessionId: string, method = "GET", body?: unknown): NextRequest {
  const headers = new Headers({ cookie: `harbour_session=${sessionId}` });
  if (body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/** Build a mock fetch that maps URL → response. Longest-key wins so
 *  `/repos/o/r/commits` matches the commits mock rather than the
 *  metadata mock at `/repos/o/r`. */
function mockGitHubFetch(map: Record<string, unknown>): void {
  vi.spyOn(global, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    const matched = Object.keys(map)
      .filter(k => url.includes(k))
      .sort((a, b) => b.length - a.length);
    const key = matched[0];
    if (!key) {
      return new Response(JSON.stringify({ error: `no mock for ${url}` }), { status: 404 });
    }
    return new Response(JSON.stringify(map[key]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("computeStaleDays", () => {
  it("returns null for missing dates", () => {
    expect(computeStaleDays(null)).toBeNull();
    expect(computeStaleDays(undefined)).toBeNull();
    expect(computeStaleDays("not-a-date")).toBeNull();
  });

  it("returns the floored day diff", () => {
    const now = new Date("2026-05-12T00:00:00Z");
    expect(computeStaleDays("2026-05-12T00:00:00Z", now)).toBe(0);
    expect(computeStaleDays("2026-05-05T00:00:00Z", now)).toBe(7);
    expect(computeStaleDays("2026-04-12T00:00:00Z", now)).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

describe("getGitHubConfigAsync", () => {
  it("returns null when owner/repo unset", async () => {
    expect(await getGitHubConfigAsync()).toBeNull();
  });

  it("returns config with decrypted token when fully set", async () => {
    await setSettingAsync("github_owner", "geekforbrains");
    await setSettingAsync("github_repo", "harbour");
    await setSettingAsync("github_default_branch", "main");
    await setSettingAsync("github_token_env_var_name", "GITHUB_TOKEN");
    await createEnvVarAsync("GITHUB_TOKEN", "ghp_pretendtoken");

    const cfg = await getGitHubConfigAsync();
    expect(cfg).not.toBeNull();
    expect(cfg?.owner).toBe("geekforbrains");
    expect(cfg?.repo).toBe("harbour");
    expect(cfg?.token).toBe("ghp_pretendtoken");
  });

  it("getGitHubPublicConfigAsync never returns the token", async () => {
    await setSettingAsync("github_owner", "x");
    await setSettingAsync("github_repo", "y");
    await createEnvVarAsync("GITHUB_TOKEN", "ghp_secret");

    const pub = await getGitHubPublicConfigAsync();
    expect(pub.tokenConfigured).toBe(true);
    expect(JSON.stringify(pub)).not.toContain("ghp_secret");
  });
});

// ---------------------------------------------------------------------------
// fetchGitHubSummary (mocked fetch)
// ---------------------------------------------------------------------------

describe("fetchGitHubSummary", () => {
  it("composes metadata + commits + issues + PRs, filters out PRs from issues", async () => {
    const now = new Date().toISOString();
    mockGitHubFetch({
      "/repos/o/r": {
        full_name: "o/r", default_branch: "main", html_url: "https://github.com/o/r",
        stargazers_count: 42, open_issues_count: 5, updated_at: now,
      },
      "/repos/o/r/commits":[
        { sha: "abc123def456789", html_url: "https://x/c1", commit: { message: "feat: ship\n\nbody", author: { name: "Alice", date: now } }, author: { login: "alice" } },
      ],
      "/repos/o/r/issues": [
        { number: 1, title: "Bug A", html_url: "https://x/i1", created_at: now, user: { login: "alice" } },
        { number: 2, title: "PR not issue", html_url: "https://x/p2", created_at: now, user: { login: "bob" }, pull_request: { url: "..." } },
      ],
      "/repos/o/r/pulls": [
        { number: 5, title: "Refactor", html_url: "https://x/p5", created_at: now, draft: false, user: { login: "carol" } },
      ],
    });

    const summary = await fetchGitHubSummary({
      owner: "o", repo: "r", defaultBranch: "main", tokenEnvVarName: "GITHUB_TOKEN", token: "t",
    });
    expect(summary.configured).toBe(true);
    expect(summary.repo?.full_name).toBe("o/r");
    expect(summary.commits).toHaveLength(1);
    expect(summary.commits[0].message).toBe("feat: ship");
    expect(summary.issues).toHaveLength(1); // PR filtered out
    expect(summary.issues[0].number).toBe(1);
    expect(summary.pullRequests).toHaveLength(1);
    expect(summary.errors).toBeUndefined();
  });

  it("degrades gracefully when one fetcher fails", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/issues")) {
        return new Response("forbidden", { status: 403 });
      }
      return new Response(JSON.stringify(
        url.includes("/pulls") ? []
        : url.includes("/commits") ? []
        : { full_name: "o/r", default_branch: "main", html_url: "", stargazers_count: 0, open_issues_count: 0, updated_at: "" }
      ), { status: 200 });
    });

    const summary = await fetchGitHubSummary({
      owner: "o", repo: "r", defaultBranch: "main", tokenEnvVarName: "GITHUB_TOKEN", token: "t",
    });
    expect(summary.repo?.full_name).toBe("o/r");
    expect(summary.errors).toBeDefined();
    expect(summary.errors?.some(e => e.startsWith("issues:"))).toBe(true);
  });
});

describe("getGitHubSummaryAsync (high-level)", () => {
  it("returns { configured: false } when nothing is set", async () => {
    const s = await getGitHubSummaryAsync();
    expect(s.configured).toBe(false);
  });

  it("returns an error when token env var is missing", async () => {
    await setSettingAsync("github_owner", "o");
    await setSettingAsync("github_repo", "r");
    const s = await getGitHubSummaryAsync();
    expect(s.configured).toBe(false);
    expect(s.errors?.[0]).toMatch(/token/);
  });
});

// ---------------------------------------------------------------------------
// Config GET/PUT endpoints
// ---------------------------------------------------------------------------

describe("/api/integrations/github/config", () => {
  it("PUT then GET round-trips the four fields and never returns the token", async () => {
    const sessionId = await adminSession();

    const putReq = authedReq("http://x/api/integrations/github/config", sessionId, "PUT", {
      owner: "geekforbrains",
      repo: "harbour",
      defaultBranch: "main",
      tokenEnvVarName: "GITHUB_TOKEN",
    });
    const putRes = await configPut(putReq, noCtx);
    expect(putRes.status).toBe(200);

    const getRes = await configGet(authedReq("http://x/api/integrations/github/config", sessionId), noCtx);
    const json = await getRes.json();
    expect(json.owner).toBe("geekforbrains");
    expect(json.repo).toBe("harbour");
    expect(json.defaultBranch).toBe("main");
    expect(json.tokenEnvVarName).toBe("GITHUB_TOKEN");
    expect(json.tokenConfigured).toBe(false);
    expect(JSON.stringify(json)).not.toMatch(/ghp_/);
  });

  it("rejects invalid characters", async () => {
    const sessionId = await adminSession();
    const r = authedReq("http://x/api/integrations/github/config", sessionId, "PUT", { owner: "../etc/passwd" });
    const res = await configPut(r, noCtx);
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Summary endpoint
// ---------------------------------------------------------------------------

describe("/api/integrations/github/summary", () => {
  it("returns { configured: false } when unconfigured", async () => {
    const sessionId = await adminSession();
    const res = await summaryGet(authedReq("http://x/api/integrations/github/summary", sessionId), noCtx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.configured).toBe(false);
  });

  it("returns the composed summary when configured", async () => {
    const sessionId = await adminSession();
    await setSettingAsync("github_owner", "o");
    await setSettingAsync("github_repo", "r");
    await setSettingAsync("github_default_branch", "main");
    await createEnvVarAsync("GITHUB_TOKEN", "ghp_token");

    const now = new Date().toISOString();
    mockGitHubFetch({
      "/repos/o/r": {
        full_name: "o/r", default_branch: "main", html_url: "https://github.com/o/r",
        stargazers_count: 0, open_issues_count: 0, updated_at: now,
      },
      "/repos/o/r/commits":[{ sha: "abcdef0", html_url: "x", commit: { message: "init", author: { name: "a", date: now } }, author: { login: "a" } }],
      "/repos/o/r/issues": [],
      "/repos/o/r/pulls": [],
    });

    const res = await summaryGet(authedReq("http://x/api/integrations/github/summary", sessionId), noCtx);
    const body = await res.json();
    expect(body.configured).toBe(true);
    expect(body.repo.full_name).toBe("o/r");
    expect(body.commits).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Today integration
// ---------------------------------------------------------------------------

describe("/api/today github block", () => {
  it("is null when unconfigured", async () => {
    const sessionId = await adminSession();
    const res = await todayGet(authedReq("http://x/api/today", sessionId), noCtx);
    const body = await res.json();
    expect(body.github).toBeNull();
  });

  it("is populated when configured + adds stale suggestion past 7 days", async () => {
    const sessionId = await adminSession();
    await setSettingAsync("github_owner", "o");
    await setSettingAsync("github_repo", "r");
    await setSettingAsync("github_default_branch", "main");
    await createEnvVarAsync("GITHUB_TOKEN", "ghp_token");

    const oldDate = new Date(Date.now() - 14 * 86_400_000).toISOString();
    mockGitHubFetch({
      "/repos/o/r": {
        full_name: "o/r", default_branch: "main", html_url: "https://github.com/o/r",
        stargazers_count: 0, open_issues_count: 0, updated_at: oldDate,
      },
      "/repos/o/r/commits":[{ sha: "stale123", html_url: "x", commit: { message: "old", author: { name: "a", date: oldDate } }, author: { login: "a" } }],
      "/repos/o/r/issues": [],
      "/repos/o/r/pulls": [],
    });

    const res = await todayGet(authedReq("http://x/api/today", sessionId), noCtx);
    const body = await res.json();
    expect(body.github).not.toBeNull();
    expect(body.github.configured).toBe(true);
    expect(body.github.repo).toBe("o/r");
    expect(body.github.staleDays).toBeGreaterThanOrEqual(13);

    const stale = body.suggestions.find((s: { id: string }) => s.id === "stale-repo");
    expect(stale).toBeDefined();
  });
});
