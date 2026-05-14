/**
 * Daily Founder Brief — formatter unit tests + extended /api/today coverage.
 *
 * The formatter is a pure JS function imported from bin/workflows/founder-brief.mjs;
 * we exercise it with hand-crafted /api/today payload shapes. The API test
 * verifies the new `completedYesterday` + `securityCallouts` fields land.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
// @ts-expect-error -- pure .mjs script, no types
import { formatBrief, isBriefEmpty } from "../../bin/workflows/founder-brief.mjs";
import { setDb, resetDb, initializeSchema, getDb } from "@/lib/db/schema";
import {
  createUserAsync,
  createSession,
  createAgent,
  createOneOffRun,
  updateRunStatusAsync,
  updateAgent,
} from "@/lib/db/queries";
import { GET as todayGet } from "@/app/api/today/route";
import { startOfTodayUnix, startOfYesterdayUnix } from "@/lib/time";

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

const noCtx = { params: Promise.resolve({} as Record<string, string>) };

// ---------------------------------------------------------------------------
// formatBrief — pure unit tests
// ---------------------------------------------------------------------------

describe("formatBrief", () => {
  it("returns markdown with Top priorities + every populated section", () => {
    const today = {
      timezone: "UTC",
      generatedAt: Math.floor(Date.now() / 1000),
      needsYou: {
        pendingApprovals: [{ action_type: "send_email", risk_level: "high" }],
        waitingRuns: [{ job_name: "review-pr", agent_name: "claude" }],
        pendingRuns: [],
        waitingWorkflowRuns: [{ workflow_name: "Sales Pipeline", current_step_name: "Draft outreach" }],
      },
      runningNow: {
        runs: [{ job_name: "summarize-tickets", agent_name: "kimi" }],
        workflowRuns: [],
      },
      failedOrStuck: {
        runs: [{ job_name: "deploy-website" }],
        workflowRuns: [],
      },
      completedToday: {
        done: [{ job_name: "morning-check" }, { job_name: "lint-pass" }],
        skipped: [],
      },
      completedYesterday: {
        done: [{ job_name: "yesterday-task" }],
        failed: [{ job_name: "yesterday-broke" }],
      },
      activeWorkflows: [
        { workflow_name: "Lead Pipeline", current_step_name: "Research lead", status: "running" },
      ],
      securityCallouts: ["1 unrestricted agent"],
      suggestions: [
        { id: "approvals", label: "Review 1 pending approval" },
        { id: "waiting-runs", label: "Respond to 1 waiting agent" },
        { id: "failed-runs", label: "Investigate 1 failed run today" },
        { id: "workflow-gates", label: "Approve 1 workflow gate" },
      ],
    };

    const md = formatBrief(today);
    expect(md).toMatch(/^# Daily Founder Brief — /);
    expect(md).toContain("## Top priorities");
    expect(md).toContain("1. Review 1 pending approval");
    expect(md).toContain("2. Respond to 1 waiting agent");
    expect(md).toContain("3. Investigate 1 failed run today");
    // Only top 3 priorities — 4th suggestion (workflow-gates) is omitted.
    expect(md).not.toContain("Approve 1 workflow gate");

    expect(md).toContain("## Needs you");
    expect(md).toContain("send email [high risk]");
    expect(md).toContain("Sales Pipeline");
    expect(md).toContain("review-pr · claude");

    expect(md).toContain("## Running now");
    expect(md).toContain("summarize-tickets · kimi");

    expect(md).toContain("## Failed or stuck");
    expect(md).toContain("deploy-website");
    expect(md).toContain("yesterday-broke");

    expect(md).toContain("## Completed");
    expect(md).toContain("morning-check");
    expect(md).toContain("yesterday-task");

    expect(md).toContain("## Active workflows");
    expect(md).toContain("Lead Pipeline");

    expect(md).toContain("## Security & cost callouts");
    expect(md).toContain("1 unrestricted agent");
  });

  it("omits sections that are empty", () => {
    const today = {
      timezone: "UTC",
      generatedAt: Math.floor(Date.now() / 1000),
      needsYou: { pendingApprovals: [], waitingRuns: [], pendingRuns: [], waitingWorkflowRuns: [] },
      runningNow: { runs: [], workflowRuns: [] },
      failedOrStuck: { runs: [{ job_name: "alpha" }], workflowRuns: [] },
      completedToday: { done: [], skipped: [] },
      completedYesterday: { done: [], failed: [] },
      activeWorkflows: [],
      securityCallouts: [],
      suggestions: [],
    };
    const md = formatBrief(today);
    expect(md).toContain("## Failed or stuck");
    expect(md).not.toContain("## Needs you");
    expect(md).not.toContain("## Running now");
    expect(md).not.toContain("## Completed");
    expect(md).not.toContain("## Active workflows");
    expect(md).not.toContain("## Security");
    expect(md).not.toContain("## Top priorities");
  });

  it("truncates lists beyond the display cap with a +N more suffix", () => {
    const lots = Array.from({ length: 12 }, (_, i) => ({ job_name: `job-${i + 1}` }));
    const today = {
      timezone: "UTC",
      generatedAt: Math.floor(Date.now() / 1000),
      needsYou: { pendingApprovals: [], waitingRuns: [], pendingRuns: [], waitingWorkflowRuns: [] },
      runningNow: { runs: [], workflowRuns: [] },
      failedOrStuck: { runs: [], workflowRuns: [] },
      completedToday: { done: lots, skipped: [] },
      completedYesterday: { done: [], failed: [] },
      activeWorkflows: [],
      securityCallouts: [],
      suggestions: [],
    };
    const md = formatBrief(today);
    expect(md).toContain("job-10");
    expect(md).not.toContain("job-11");
    expect(md).toContain("…and 2 more");
  });
});

describe("isBriefEmpty", () => {
  it("returns true when every section is empty", () => {
    expect(isBriefEmpty({
      needsYou: { pendingApprovals: [], waitingRuns: [], pendingRuns: [], waitingWorkflowRuns: [] },
      runningNow: { runs: [], workflowRuns: [] },
      failedOrStuck: { runs: [], workflowRuns: [] },
      completedToday: { done: [], skipped: [] },
      completedYesterday: { done: [], failed: [] },
      activeWorkflows: [],
      securityCallouts: [],
    })).toBe(true);
  });

  it("returns false if any section has content", () => {
    expect(isBriefEmpty({
      needsYou: { pendingApprovals: [], waitingRuns: [], pendingRuns: [], waitingWorkflowRuns: [] },
      runningNow: { runs: [], workflowRuns: [] },
      failedOrStuck: { runs: [], workflowRuns: [] },
      completedToday: { done: [{ job_name: "x" }], skipped: [] },
      completedYesterday: { done: [], failed: [] },
      activeWorkflows: [],
      securityCallouts: [],
    })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// /api/today — verify the new fields land
// ---------------------------------------------------------------------------

describe("/api/today (extended fields)", () => {
  it("includes completedYesterday + securityCallouts", async () => {
    // session
    const u = await createUserAsync("admin@x.com", "test-pw-1!!", "Admin", "admin");
    const sessionId = createSession(u!.id);

    // Yesterday-completed run.
    const agent = createAgent("brief-bot", "", { type: "harbour", cli: "claude", model: "sonnet" });
    const r = createOneOffRun(agent.id, { name: "yesterday-done", instructions: "x" });
    await updateRunStatusAsync(r.runId, "done");
    const yesterday = startOfYesterdayUnix() + 1000;
    getDb().prepare(`UPDATE runs SET completed_at = ? WHERE id = ?`).run(yesterday, r.runId);

    // Yesterday-failed run.
    const r2 = createOneOffRun(agent.id, { name: "yesterday-failed", instructions: "x" });
    await updateRunStatusAsync(r2.runId, "failed");
    getDb().prepare(`UPDATE runs SET completed_at = ? WHERE id = ?`).run(yesterday + 60, r2.runId);

    // Today-completed run — should NOT appear in yesterday's bucket.
    const r3 = createOneOffRun(agent.id, { name: "today-done", instructions: "x" });
    await updateRunStatusAsync(r3.runId, "done");

    // Unrestricted agent → triggers a security callout.
    const risky = createAgent("risky-bot", "", { type: "harbour", cli: "claude", model: "sonnet" });
    updateAgent(risky.id, { permissionMode: "unrestricted" });

    const headers = new Headers({ cookie: `harbour_session=${sessionId}` });
    const req = new NextRequest("http://x/api/today", { method: "GET", headers });
    const res = await todayGet(req, noCtx);
    expect(res.status).toBe(200);
    const body = await res.json();

    // completedYesterday is populated and bound to the yesterday window.
    const yDoneNames = body.completedYesterday.done.map((x: { job_name: string }) => x.job_name);
    expect(yDoneNames).toContain("yesterday-done");
    expect(yDoneNames).not.toContain("today-done");

    const yFailNames = body.completedYesterday.failed.map((x: { job_name: string }) => x.job_name);
    expect(yFailNames).toContain("yesterday-failed");

    // Today-completed shouldn't leak into yesterday.
    expect(body.completedToday.done.map((x: { job_name: string }) => x.job_name)).toContain("today-done");

    // Security callouts surface the unrestricted agent.
    expect(body.securityCallouts.some((s: string) => s.includes("unrestricted"))).toBe(true);

    // The 'today' boundary is correct: yesterday-done is at startOfYesterday+1000s,
    // strictly less than startOfToday.
    expect(yesterday).toBeLessThan(startOfTodayUnix());
  });
});
