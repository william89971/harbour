/**
 * GET /api/today aggregator — verifies the Today command-center endpoint
 * groups runs / workflow runs / approvals correctly and respects the
 * timezone-aware "completed today" cutoff.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { setDb, resetDb, initializeSchema, getDb } from "@/lib/db/schema";
import {
  createUserAsync,
  createSession,
  createAgent,
  createOneOffRun,
  updateRunStatusAsync,
  createApprovalRequestAsync,
  createWorkflow,
  createWorkflowStep,
  createDocAsync,
} from "@/lib/db/queries";
import { GET as todayGet } from "@/app/api/today/route";
import { startOfTodayUnix } from "@/lib/time";
import { v4 as uuid } from "uuid";

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

async function sessionFor(role: "admin" | "operator" | "viewer" = "admin"): Promise<string> {
  const u = await createUserAsync(`${role}@x.com`, "test-pw-1!!", `User-${role}`, role);
  return createSession(u!.id);
}

function getReq(sessionId: string): NextRequest {
  const headers = new Headers({ cookie: `harbour_session=${sessionId}` });
  return new NextRequest("http://x/api/today", { method: "GET", headers });
}

const noCtx = { params: Promise.resolve({} as Record<string, string>) };

describe("GET /api/today", () => {
  it("aggregates pending approvals, running/failed/done runs, and active workflow runs", async () => {
    const sessionId = await sessionFor("admin");

    // Agent + a few runs.
    const agent = createAgent("Today-bot", "", { type: "harbour", cli: "claude", model: "sonnet" });

    // 1) Completed today (done).
    const r1 = createOneOffRun(agent.id, { name: "done-today", instructions: "x" });
    await updateRunStatusAsync(r1.runId, "done");

    // 2) Completed yesterday — should NOT appear in completedToday.
    const r2 = createOneOffRun(agent.id, { name: "done-yesterday", instructions: "x" });
    await updateRunStatusAsync(r2.runId, "done");
    const yesterday = startOfTodayUnix() - 12 * 3600;
    getDb().prepare(`UPDATE runs SET completed_at = ? WHERE id = ?`).run(yesterday, r2.runId);

    // 3) Failed today — appears in failedOrStuck.
    const r3 = createOneOffRun(agent.id, { name: "failed-today", instructions: "x" });
    await updateRunStatusAsync(r3.runId, "failed");

    // 4) Running run — appears in runningNow.
    const r4 = createOneOffRun(agent.id, { name: "running-now", instructions: "x" });
    await updateRunStatusAsync(r4.runId, "running");

    // 5) Waiting run — appears in needsYou.
    const r5 = createOneOffRun(agent.id, { name: "waiting-on-human", instructions: "x" });
    await updateRunStatusAsync(r5.runId, "waiting");

    // Pending approval.
    await createApprovalRequestAsync({
      sourceType: "tool_call",
      sourceId: "src-1",
      actionType: "send_email",
      riskLevel: "high",
    });

    // Workflow with a running workflow_run.
    const wf = createWorkflow({ name: "Lead Pipeline", autonomyLevel: "supervised" });
    createWorkflowStep(wf.id, {
      name: "Research lead",
      instructions: "Research the lead",
      assignedAgentId: agent.id,
    });
    const wfRunId = uuid();
    getDb()
      .prepare(
        `INSERT INTO workflow_runs (id, workflow_id, status, started_at) VALUES (?, ?, 'running', unixepoch())`,
      )
      .run(wfRunId, wf.id);

    const res = await todayGet(getReq(sessionId), noCtx);
    expect(res.status).toBe(200);
    const body = await res.json();

    // Completed today.
    const doneNames = body.completedToday.done.map((r: { job_name: string }) => r.job_name);
    expect(doneNames).toContain("done-today");
    expect(doneNames).not.toContain("done-yesterday");

    // Failed today.
    const failedNames = body.failedOrStuck.runs.map((r: { job_name: string }) => r.job_name);
    expect(failedNames).toContain("failed-today");

    // Running.
    const runningNames = body.runningNow.runs.map((r: { job_name: string }) => r.job_name);
    expect(runningNames).toContain("running-now");

    // Needs you — waiting run + approval + waiting workflow gates (0 here).
    const waitingNames = body.needsYou.waitingRuns.map((r: { job_name: string }) => r.job_name);
    expect(waitingNames).toContain("waiting-on-human");
    expect(body.needsYou.pendingApprovals).toHaveLength(1);
    expect(body.needsYou.pendingApprovals[0].action_type).toBe("send_email");

    // Active workflow runs include the running one with the joined workflow_name.
    expect(body.activeWorkflows.length).toBeGreaterThanOrEqual(1);
    const activeNames = body.activeWorkflows.map((w: { workflow_name: string | null }) => w.workflow_name);
    expect(activeNames).toContain("Lead Pipeline");

    // Suggestions reflect the situation.
    const suggestionIds = body.suggestions.map((s: { id: string }) => s.id);
    expect(suggestionIds).toContain("approvals");
    expect(suggestionIds).toContain("waiting-runs");
    expect(suggestionIds).toContain("failed-runs");
  });

  it("returns empty sections and a weekly review suggestion on a clean DB", async () => {
    const sessionId = await sessionFor("admin");
    const res = await todayGet(getReq(sessionId), noCtx);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.needsYou.pendingApprovals).toEqual([]);
    expect(body.needsYou.waitingRuns).toEqual([]);
    expect(body.runningNow.runs).toEqual([]);
    expect(body.completedToday.done).toEqual([]);
    expect(body.failedOrStuck.runs).toEqual([]);

    const suggestionIds = body.suggestions.map((s: { id: string }) => s.id);
    expect(suggestionIds).toContain("weekly-review");
    expect(body.weeklyReview.latest).toBeNull();
  });

  it("surfaces the latest weekly review", async () => {
    const sessionId = await sessionFor("admin");
    const review = await createDocAsync(
      "Weekly Review - 2026-05-01 to 2026-05-07",
      "## Recommended priorities for next week\n- Unblock product launch.\n- Review outreach drafts.\n",
      "user",
      "u1",
    );

    const res = await todayGet(getReq(sessionId), noCtx);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.weeklyReview.latest.id).toBe(review!.id);
    expect(body.weeklyReview.latest.recommendations).toContain("Unblock product launch.");
  });

  it("is reachable by viewer role", async () => {
    const sessionId = await sessionFor("viewer");
    const res = await todayGet(getReq(sessionId), noCtx);
    expect(res.status).toBe(200);
  });
});
