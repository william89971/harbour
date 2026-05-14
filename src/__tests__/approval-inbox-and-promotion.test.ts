/**
 * Approval Inbox + Memory Promotion — backend coverage.
 *
 * - Joined approvals listing surfaces requested_by_agent_name.
 * - Count endpoint returns the correct pending count.
 * - Existing approve flow still works after the route swap to the
 *   joined helper (regression).
 * - Memory-promotion smoke: tasks/decisions/goals/docs POST endpoints
 *   accept the prefilled body shapes the SaveAsMenu component sends.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { setDb, resetDb, initializeSchema } from "@/lib/db/schema";
import {
  createUserAsync,
  createSession,
  createAgent,
  createApprovalRequestAsync,
  listApprovalRequestsWithAgentAsync,
  countApprovalRequestsAsync,
  listTasksAsync,
  listDecisionsAsync,
  listGoalsAsync,
  listDocsAsync,
} from "@/lib/db/queries";
import { GET as approvalsListGet } from "@/app/api/autonomy/approvals/route";
import { GET as approvalsCountGet } from "@/app/api/autonomy/approvals/count/route";
import { POST as approvalApprovePost } from "@/app/api/autonomy/approvals/[id]/approve/route";
import { POST as tasksPost } from "@/app/api/tasks/route";
import { POST as decisionsPost } from "@/app/api/decisions/route";
import { POST as goalsPost } from "@/app/api/goals/route";
import { POST as docsPost } from "@/app/api/docs/route";

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

// ---------------------------------------------------------------------------
// Approval listing with agent join
// ---------------------------------------------------------------------------

describe("listApprovalRequestsWithAgentAsync", () => {
  it("includes the requesting agent name", async () => {
    const agent = createAgent("Product Reviewer", "", { type: "harbour", cli: "shell", shellCommand: "echo" });
    await createApprovalRequestAsync({
      sourceType: "tool_call",
      sourceId: "r-1",
      requestedByAgentId: agent.id,
      actionType: "send_email",
      riskLevel: "high",
      reason: "drafted outreach",
    });
    const rows = await listApprovalRequestsWithAgentAsync({ status: "pending" });
    expect(rows).toHaveLength(1);
    expect(rows[0].requested_by_agent_name).toBe("Product Reviewer");
  });

  it("returns null name when requested_by_agent_id is null", async () => {
    await createApprovalRequestAsync({
      sourceType: "tool_call",
      sourceId: "r-2",
      actionType: "spend_money",
      riskLevel: "medium",
    });
    const rows = await listApprovalRequestsWithAgentAsync({ status: "pending" });
    expect(rows).toHaveLength(1);
    expect(rows[0].requested_by_agent_name).toBeNull();
  });
});

describe("countApprovalRequestsAsync", () => {
  it("counts by status", async () => {
    await createApprovalRequestAsync({ sourceType: "tool_call", sourceId: "a", actionType: "send_email", riskLevel: "low" });
    await createApprovalRequestAsync({ sourceType: "tool_call", sourceId: "b", actionType: "send_email", riskLevel: "low" });
    expect(await countApprovalRequestsAsync({ status: "pending" })).toBe(2);
    expect(await countApprovalRequestsAsync({ status: "approved" })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// GET routes
// ---------------------------------------------------------------------------

describe("GET /api/autonomy/approvals", () => {
  it("returns approvals[] with the joined agent name", async () => {
    const sessionId = await adminSession();
    const agent = createAgent("Brief Bot", "", { type: "harbour", cli: "shell", shellCommand: "echo" });
    await createApprovalRequestAsync({
      sourceType: "tool_call",
      sourceId: "r-1",
      requestedByAgentId: agent.id,
      actionType: "send_email",
      riskLevel: "high",
    });
    const res = await approvalsListGet(authedReq("http://x/api/autonomy/approvals?status=pending", sessionId), noCtx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.approvals[0].requested_by_agent_name).toBe("Brief Bot");
  });
});

describe("GET /api/autonomy/approvals/count", () => {
  it("returns the pending count", async () => {
    const sessionId = await adminSession();
    await createApprovalRequestAsync({ sourceType: "tool_call", sourceId: "a", actionType: "send_email", riskLevel: "low" });
    await createApprovalRequestAsync({ sourceType: "tool_call", sourceId: "b", actionType: "spend_money", riskLevel: "low" });
    const res = await approvalsCountGet(authedReq("http://x/api/autonomy/approvals/count?status=pending", sessionId), noCtx);
    const body = await res.json();
    expect(body.count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Approve flow regression
// ---------------------------------------------------------------------------

describe("POST /api/autonomy/approvals/:id/approve still works after the route swap", () => {
  it("approves the request and stores the comment", async () => {
    const sessionId = await adminSession();
    const req = await createApprovalRequestAsync({
      sourceType: "tool_call", sourceId: "r-1", actionType: "send_email", riskLevel: "high",
    });
    const res = await approvalApprovePost(
      authedReq(`http://x/api/autonomy/approvals/${req.id}/approve`, sessionId, "POST", { comment: "lgtm" }),
      { params: Promise.resolve({ id: req.id }) },
    );
    expect(res.status).toBe(200);
    expect(await countApprovalRequestsAsync({ status: "approved" })).toBe(1);
    expect(await countApprovalRequestsAsync({ status: "pending" })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Memory promotion — POST routes accept the prefilled bodies
// ---------------------------------------------------------------------------

describe("Memory promotion endpoints", () => {
  it("POST /api/tasks accepts a prefilled body", async () => {
    const sessionId = await adminSession();
    const res = await tasksPost(
      authedReq("http://x/api/tasks", sessionId, "POST", {
        title: "Promoted task",
        notes: "Body from a run activity\n\n---\nPromoted from run /runs/abc",
        priority: "high",
      }),
      noCtx,
    );
    expect(res.status).toBe(201);
    const tasks = await listTasksAsync();
    expect(tasks.map(t => t.title)).toContain("Promoted task");
    expect(tasks.find(t => t.title === "Promoted task")?.priority).toBe("high");
  });

  it("POST /api/decisions accepts a prefilled body", async () => {
    const sessionId = await adminSession();
    const res = await decisionsPost(
      authedReq("http://x/api/decisions", sessionId, "POST", {
        title: "Use SQLite",
        decision: "Default to SQLite for solo installs.",
        rationale: "Single-file backups, zero-ops.",
      }),
      noCtx,
    );
    expect(res.status).toBe(201);
    const decisions = await listDecisionsAsync();
    expect(decisions.map(d => d.title)).toContain("Use SQLite");
  });

  it("POST /api/goals accepts a prefilled body", async () => {
    const sessionId = await adminSession();
    const res = await goalsPost(
      authedReq("http://x/api/goals", sessionId, "POST", {
        title: "Ship V1",
        notes: "From workflow run feedback.",
        priority: "high",
        target_date: 2_000_000_000,
      }),
      noCtx,
    );
    expect(res.status).toBe(201);
    const goals = await listGoalsAsync();
    expect(goals.map(g => g.title)).toContain("Ship V1");
  });

  it("POST /api/docs accepts a prefilled body", async () => {
    const sessionId = await adminSession();
    const res = await docsPost(
      authedReq("http://x/api/docs", sessionId, "POST", {
        title: "Brief — 2026-05-12",
        content: "# Daily brief\n\nAll quiet on the western front.",
      }),
      noCtx,
    );
    expect(res.status).toBe(201);
    const docs = await listDocsAsync();
    expect(docs.map(d => (d as { title: string }).title)).toContain("Brief — 2026-05-12");
  });
});
