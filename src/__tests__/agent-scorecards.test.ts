/**
 * Agent Scorecards — coverage:
 *   - upsertRunFeedbackAsync: insert then update for (run, user)
 *   - computeAgentScorecardAsync: success/failure rate, costs, approvals, feedback
 *   - listAgentScorecardsAsync: one row per agent
 *   - POST /api/runs/:id/feedback: returns 200; second call is upsert
 *   - GET /api/today includes agentHealth + weak-agents suggestion
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
  approveRequestAsync,
  rejectRequestAsync,
  upsertRunFeedbackAsync,
  countAgentFeedbackAsync,
  computeAgentScorecardAsync,
  listAgentScorecardsAsync,
} from "@/lib/db/queries";
import { POST as feedbackPost, GET as feedbackGet } from "@/app/api/runs/[id]/feedback/route";
import { GET as scorecardGet } from "@/app/api/agents/[id]/scorecard/route";
import { GET as scorecardsGet } from "@/app/api/agents/scorecards/route";
import { GET as todayGet } from "@/app/api/today/route";
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

const noCtx = { params: Promise.resolve({} as Record<string, string>) };

async function adminSession(): Promise<{ sessionId: string; userId: string }> {
  const u = await createUserAsync("admin@x.com", "test-pw-1!!", "Admin", "admin");
  const sessionId = createSession(u!.id);
  return { sessionId, userId: u!.id };
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

// ---------------------------------------------------------------------------
// Feedback helper
// ---------------------------------------------------------------------------

describe("upsertRunFeedbackAsync", () => {
  it("upserts: second call for same (run, user) updates the row", async () => {
    const { userId } = await adminSession();
    const agent = createAgent("A1", "", { type: "harbour", cli: "claude", model: "sonnet" });
    const r = createOneOffRun(agent.id, { name: "x", instructions: "x" });
    const first = await upsertRunFeedbackAsync({ runId: r.runId, userId, rating: "useful" });
    const second = await upsertRunFeedbackAsync({ runId: r.runId, userId, rating: "not_useful", comment: "changed mind" });
    expect(second.id).toBe(first.id);
    expect(second.rating).toBe("not_useful");
    expect(second.comment).toBe("changed mind");
    const counts = await countAgentFeedbackAsync(agent.id);
    expect(counts.useful).toBe(0);
    expect(counts.not_useful).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// computeAgentScorecardAsync
// ---------------------------------------------------------------------------

describe("computeAgentScorecardAsync", () => {
  it("returns null for unknown agent", async () => {
    expect(await computeAgentScorecardAsync("nope")).toBeNull();
  });

  it("computes success/failure rate from seeded runs", async () => {
    const agent = createAgent("A1", "", { type: "harbour", cli: "claude", model: "sonnet" });
    const r1 = createOneOffRun(agent.id, { name: "a", instructions: "x" });
    await updateRunStatusAsync(r1.runId, "done");
    const r2 = createOneOffRun(agent.id, { name: "b", instructions: "x" });
    await updateRunStatusAsync(r2.runId, "done");
    const r3 = createOneOffRun(agent.id, { name: "c", instructions: "x" });
    await updateRunStatusAsync(r3.runId, "failed");

    const card = await computeAgentScorecardAsync(agent.id)!;
    expect(card).not.toBeNull();
    expect(card!.total_runs).toBe(3);
    expect(card!.completed_runs).toBe(2);
    expect(card!.failed_runs).toBe(1);
    expect(card!.success_rate).toBeCloseTo(2 / 3, 5);
    expect(card!.failure_rate).toBeCloseTo(1 / 3, 5);
    expect(card!.last_run_at).not.toBeNull();
    expect(card!.last_successful_run_at).not.toBeNull();
  });

  it("aggregates costs from run_costs", async () => {
    const agent = createAgent("A2", "", { type: "harbour", cli: "claude", model: "sonnet" });
    const r = createOneOffRun(agent.id, { name: "a", instructions: "x" });
    await updateRunStatusAsync(r.runId, "done");
    getDb().prepare(
      `INSERT INTO run_costs (id, run_id, estimated_cost_usd, pricing_known) VALUES (?, ?, ?, 1)`,
    ).run(uuid(), r.runId, 0.42);

    const card = await computeAgentScorecardAsync(agent.id);
    expect(card!.total_cost_usd).toBeCloseTo(0.42, 5);
    expect(card!.avg_cost_usd).toBeCloseTo(0.42, 5);
  });

  it("counts approval_requests by agent + by status", async () => {
    const { userId } = await adminSession();
    const agent = createAgent("A3", "", { type: "harbour", cli: "claude", model: "sonnet" });
    const a1 = await createApprovalRequestAsync({
      sourceType: "tool_call", sourceId: "s1", requestedByAgentId: agent.id,
      actionType: "send_email", riskLevel: "high",
    });
    const a2 = await createApprovalRequestAsync({
      sourceType: "tool_call", sourceId: "s2", requestedByAgentId: agent.id,
      actionType: "send_email", riskLevel: "high",
    });
    await approveRequestAsync(a1.id, userId);
    await rejectRequestAsync(a2.id, userId);

    const card = await computeAgentScorecardAsync(agent.id);
    expect(card!.approvals_requested).toBe(2);
    expect(card!.approvals_approved).toBe(1);
    expect(card!.approvals_rejected).toBe(1);
  });

  it("aggregates feedback ratings + ratio", async () => {
    const { userId } = await adminSession();
    const u2 = await createUserAsync("op@x.com", "p", "Op", "operator");
    const agent = createAgent("A4", "", { type: "harbour", cli: "claude", model: "sonnet" });
    const r = createOneOffRun(agent.id, { name: "a", instructions: "x" });
    await updateRunStatusAsync(r.runId, "done");
    await upsertRunFeedbackAsync({ runId: r.runId, userId, rating: "useful" });
    await upsertRunFeedbackAsync({ runId: r.runId, userId: u2!.id, rating: "not_useful" });

    const card = await computeAgentScorecardAsync(agent.id);
    expect(card!.feedback_useful).toBe(1);
    expect(card!.feedback_not_useful).toBe(1);
    expect(card!.usefulness_ratio).toBeCloseTo(0.5, 5);
  });

  it("derives flags: failing when failure_rate > 0.5 and >= 3 runs", async () => {
    const agent = createAgent("A5", "", { type: "harbour", cli: "claude", model: "sonnet" });
    for (let i = 0; i < 4; i++) {
      const r = createOneOffRun(agent.id, { name: `r${i}`, instructions: "x" });
      await updateRunStatusAsync(r.runId, i === 0 ? "done" : "failed");
    }
    const card = await computeAgentScorecardAsync(agent.id);
    expect(card!.flags.failing).toBe(true);
  });
});

describe("listAgentScorecardsAsync", () => {
  it("returns one entry per agent", async () => {
    createAgent("A1", "", { type: "harbour", cli: "claude", model: "sonnet" });
    createAgent("A2", "", { type: "harbour", cli: "claude", model: "sonnet" });
    const list = await listAgentScorecardsAsync();
    expect(list).toHaveLength(2);
    expect(list.map(c => c.agent_name).sort()).toEqual(["A1", "A2"]);
  });
});

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

describe("POST /api/runs/:id/feedback", () => {
  it("inserts then upserts on second POST", async () => {
    const { sessionId } = await adminSession();
    const agent = createAgent("A", "", { type: "harbour", cli: "claude", model: "sonnet" });
    const run = createOneOffRun(agent.id, { name: "a", instructions: "x" });

    const r1 = await feedbackPost(
      authedReq(`http://x/api/runs/${run.runId}/feedback`, sessionId, "POST", { rating: "useful" }),
      { params: Promise.resolve({ id: run.runId }) },
    );
    expect(r1.status).toBe(200);
    const r2 = await feedbackPost(
      authedReq(`http://x/api/runs/${run.runId}/feedback`, sessionId, "POST", { rating: "not_useful", comment: "second" }),
      { params: Promise.resolve({ id: run.runId }) },
    );
    expect(r2.status).toBe(200);

    const rg = await feedbackGet(
      authedReq(`http://x/api/runs/${run.runId}/feedback`, sessionId),
      { params: Promise.resolve({ id: run.runId }) },
    );
    const json = await rg.json();
    expect(json.mine.rating).toBe("not_useful");
    expect(json.mine.comment).toBe("second");
    expect(json.all).toHaveLength(1);
  });

  it("rejects invalid rating", async () => {
    const { sessionId } = await adminSession();
    const agent = createAgent("A", "", { type: "harbour", cli: "claude", model: "sonnet" });
    const run = createOneOffRun(agent.id, { name: "a", instructions: "x" });
    const r = await feedbackPost(
      authedReq(`http://x/api/runs/${run.runId}/feedback`, sessionId, "POST", { rating: "bogus" }),
      { params: Promise.resolve({ id: run.runId }) },
    );
    expect(r.status).toBe(400);
  });
});

describe("GET /api/agents/:id/scorecard + /api/agents/scorecards", () => {
  it("scorecard endpoint returns the card", async () => {
    const { sessionId } = await adminSession();
    const agent = createAgent("A", "", { type: "harbour", cli: "claude", model: "sonnet" });
    const r = await scorecardGet(
      authedReq(`http://x/api/agents/${agent.id}/scorecard`, sessionId),
      { params: Promise.resolve({ id: agent.id }) },
    );
    expect(r.status).toBe(200);
    const json = await r.json();
    expect(json.agent_id).toBe(agent.id);
  });

  it("scorecards endpoint returns array", async () => {
    const { sessionId } = await adminSession();
    createAgent("A", "", { type: "harbour", cli: "claude", model: "sonnet" });
    const r = await scorecardsGet(authedReq(`http://x/api/agents/scorecards`, sessionId), noCtx);
    const json = await r.json();
    expect(Array.isArray(json)).toBe(true);
    expect(json.length).toBe(1);
  });
});

describe("/api/today agentHealth + weak-agents suggestion", () => {
  it("populates agentHealth.failing when failure rate > 0.5", async () => {
    const { sessionId } = await adminSession();
    const agent = createAgent("FlakyBot", "", { type: "harbour", cli: "claude", model: "sonnet" });
    for (let i = 0; i < 4; i++) {
      const r = createOneOffRun(agent.id, { name: `r${i}`, instructions: "x" });
      await updateRunStatusAsync(r.runId, i === 0 ? "done" : "failed");
    }
    const res = await todayGet(authedReq(`http://x/api/today`, sessionId), noCtx);
    const json = await res.json();
    expect(json.agentHealth).not.toBeNull();
    const failing = json.agentHealth.failing as Array<{ name: string }>;
    expect(failing.some(f => f.name === "FlakyBot")).toBe(true);
    expect(json.suggestions.some((s: { id: string }) => s.id === "weak-agents")).toBe(true);
  });

  it("returns null agentHealth when nothing is flagged", async () => {
    const { sessionId } = await adminSession();
    createAgent("A", "", { type: "harbour", cli: "claude", model: "sonnet" });
    const res = await todayGet(authedReq(`http://x/api/today`, sessionId), noCtx);
    const json = await res.json();
    expect(json.agentHealth).toBeNull();
  });
});
