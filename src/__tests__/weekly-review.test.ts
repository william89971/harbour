/**
 * Weekly Review V1 - generator, durable Doc save API, and workflow script
 * formatter coverage.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { setDb, resetDb, initializeSchema, getDb } from "@/lib/db/schema";
import {
  createUserAsync,
  createSession,
  createAgent,
  createGoalAsync,
  createTaskAsync,
  createDecisionAsync,
  createOneOffRun,
  updateRunStatusAsync,
} from "@/lib/db/queries";
import { recordRunCostAsync } from "@/lib/db/costs";
import {
  extractWeeklyReviewRecommendations,
  listRecentWeeklyReviewsAsync,
  renderWeeklyReviewMarkdown,
  type WeeklyReviewData,
} from "@/lib/weekly-review";
import { POST as runWeeklyReviewPost } from "@/app/api/weekly-reviews/run/route";
import { GET as weeklyReviewsGet } from "@/app/api/weekly-reviews/route";
// @ts-expect-error -- pure .mjs script, no types
import { formatWeeklyReviewRunOutput } from "../../bin/workflows/weekly-review.mjs";

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
afterEach(() => resetDb());

async function adminSession(): Promise<string> {
  const u = await createUserAsync("admin@x.com", "test-pw-1!!", "Admin", "admin");
  return createSession(u!.id);
}

const noCtx = { params: Promise.resolve({} as Record<string, string>) };

describe("Weekly Review renderer", () => {
  it("renders required sections and extractable recommendations", () => {
    const data: WeeklyReviewData = {
      generatedAt: 1_700_000_000,
      timezone: "UTC",
      startTs: 1_699_395_200,
      endTs: 1_700_000_000,
      rangeLabel: "2023-11-07 to 2023-11-14",
      goals: {
        active: [{ id: "g1", title: "Ship MVP", notes: null, status: "active", priority: "high", target_date: null, updated_at: 1 }],
        completedThisWeek: [],
        progress: [{ goalId: "g1", openTasks: 2, doneThisWeek: 1, blockedTasks: 1 }],
      },
      tasks: {
        completed: [{ id: "t1", title: "Fix auth", notes: null, status: "done", priority: "high", goal_id: "g1", goal_title: "Ship MVP", updated_at: 1 }],
        open: [{ id: "t2", title: "Write onboarding", notes: null, status: "todo", priority: "medium", goal_id: "g1", goal_title: "Ship MVP", updated_at: 1 }],
        blocked: [{ id: "t3", title: "Waiting on Stripe", notes: null, status: "blocked", priority: "medium", goal_id: null, goal_title: null, updated_at: 1 }],
      },
      decisions: [{ id: "d1", title: "Use SQLite", decision: "Default solo installs to SQLite.", rationale: null, created_at: 1 }],
      runs: { completed: [], failed: [{ id: "r1", status: "failed", job_name: "Deploy", agent_name: "Bot", completed_at: 1, updated_at: 1 }], killed: [], skipped: [] },
      workflows: { active: [], failed: [] },
      agents: [],
      costs: {
        summary: { total_cost_usd: 0, input_tokens: 0, output_tokens: 0, total_tokens: 0, run_count: 0, unknown_pricing_runs: 0 },
        breakdown: [],
      },
      github: null,
      growth: { newContacts: 0, researchedContacts: 0, contactedOrReplied: 0, draftCount: 0, pendingApprovalCount: 0, sentCount: 0 },
      pendingApprovals: 0,
      recommendations: ["Unblock the Stripe task.", "Retry the failed deploy."],
    };

    const md = renderWeeklyReviewMarkdown(data);
    expect(md).toContain("# Weekly Review - 2023-11-07 to 2023-11-14");
    expect(md).toContain("## Goals progress");
    expect(md).toContain("## Completed tasks");
    expect(md).toContain("## Runs completed, failed, killed, skipped");
    expect(md).toContain("## Recommended priorities for next week");
    expect(extractWeeklyReviewRecommendations(md)).toEqual([
      "Unblock the Stripe task.",
      "Retry the failed deploy.",
    ]);
  });
});

describe("POST /api/weekly-reviews/run", () => {
  it("creates a durable review Doc and exposes it via the list endpoint", async () => {
    const sessionId = await adminSession();
    const agent = createAgent("review-bot", "", { type: "harbour", cli: "claude", model: "sonnet" });
    const goal = await createGoalAsync({ title: "Ship Company OS", priority: "high" });
    const done = await createTaskAsync({ title: "Complete daily brief", status: "done", priority: "high", goalId: goal.id });
    await createTaskAsync({ title: "Fix blocked workflow", status: "blocked", priority: "medium", goalId: goal.id });
    await createDecisionAsync({ title: "Use Docs for reviews", decision: "Weekly Reviews are saved as Docs." });

    const run = createOneOffRun(agent.id, { name: "weekly-review-source-run", instructions: "x" });
    await updateRunStatusAsync(run.runId, "done");
    await recordRunCostAsync(run.runId, { provider: "openai", model: "gpt-5.4", input_tokens: 1000, output_tokens: 500 });

    const now = Math.floor(Date.now() / 1000);
    getDb().prepare(`UPDATE tasks SET updated_at = ? WHERE id = ?`).run(now, done.id);
    getDb().prepare(`UPDATE decisions SET created_at = ? WHERE title = ?`).run(now, "Use Docs for reviews");
    getDb().prepare(`UPDATE runs SET completed_at = ? WHERE id = ?`).run(now, run.runId);

    const headers = new Headers({ cookie: `harbour_session=${sessionId}`, "Content-Type": "application/json" });
    const req = new NextRequest("http://x/api/weekly-reviews/run", {
      method: "POST",
      headers,
      body: JSON.stringify({ start_ts: now - 3600, end_ts: now + 3600 }),
    });
    const res = await runWeeklyReviewPost(req, noCtx);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.doc.title).toContain("Weekly Review -");
    expect(body.doc.content).toContain("Complete daily brief");
    expect(body.doc.content).toContain("Use Docs for reviews");
    expect(body.review.recommendations.length).toBeGreaterThan(0);

    const recent = await listRecentWeeklyReviewsAsync(5);
    expect(recent).toHaveLength(1);
    expect(recent[0].recommendations.length).toBeGreaterThan(0);

    const listReq = new NextRequest("http://x/api/weekly-reviews", {
      method: "GET",
      headers: new Headers({ cookie: `harbour_session=${sessionId}` }),
    });
    const listRes = await weeklyReviewsGet(listReq, noCtx);
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.latest.title).toBe(body.doc.title);
    expect(listBody.due).toBe(false);
  });
});

describe("weekly-review workflow script", () => {
  it("formats a concise activity summary for the saved review", () => {
    const out = formatWeeklyReviewRunOutput({
      doc: { id: "doc_1", title: "Weekly Review - 2026-05-01 to 2026-05-07" },
      review: {
        rangeLabel: "2026-05-01 to 2026-05-07",
        recommendations: ["Unblock product launch.", "Review outreach drafts."],
      },
    }, "http://localhost:3000");

    expect(out).toContain("# Weekly Review saved");
    expect(out).toContain("http://localhost:3000/docs/doc_1");
    expect(out).toContain("Unblock product launch.");
  });
});

