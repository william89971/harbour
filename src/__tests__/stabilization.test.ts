/**
 * Stabilization-pass coverage: the defects flagged by the audit and fixed
 * across workflows, autonomy, and the route layer.
 *
 *  - Workflow CAS guard on approve/reject (double-click race)
 *  - Orphan step (no agent, no team) rejection at create + update
 *  - Cross-workflow reorder rejection
 *  - Paused workflow start rejection (route-layer + status check)
 *  - Default global policy cannot be deleted via API
 *  - Internal autonomy check rejects user callers (agent-only)
 *  - setPolicyRuleAsync native UPSERT survives concurrent writes
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { setDb, resetDb, initializeSchema } from "@/lib/db/schema";
import {
  createAgentAsync, createUserAsync, createSession,
  createWorkflowAsync, createWorkflowStepAsync, updateWorkflowStepAsync,
  reorderWorkflowStepsAsync,
  startWorkflowRunAsync,
  approveCurrentStepAsync, rejectWorkflowRunAsync,
  updateWorkflowAsync,
  setPolicyRuleAsync, listPolicyRulesAsync,
} from "@/lib/db/queries";
import { WorkflowConflictError } from "@/lib/db/workflows";
import { DELETE as deletePolicyDELETE } from "@/app/api/autonomy/policies/[id]/route";
import { POST as autonomyCheckPOST } from "@/app/api/internal/autonomy/check/route";
import { POST as startWorkflowPOST } from "@/app/api/workflows/[id]/start/route";

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

async function makeAgent(name = "Worker") {
  return createAgentAsync(name, "", { type: "harbour", cli: "claude", model: "sonnet" });
}
async function makeUser(email = "approver@example.com", role: "admin" | "operator" | "viewer" = "operator") {
  const u = await createUserAsync(email, "test-pw-1!!", `User-${role}`, role);
  if (!u) throw new Error("user creation failed");
  const sessionId = createSession(u.id);
  return { user: u, sessionId };
}

function makeReq(url: string, sessionId: string, body?: unknown, method = "POST"): NextRequest {
  const headers = new Headers({ cookie: `harbour_session=${sessionId}`, "content-type": "application/json" });
  return new NextRequest(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

describe("workflow: CAS on approve", () => {
  it("second concurrent approve throws WorkflowConflictError", async () => {
    const agent = await makeAgent();
    const w = await createWorkflowAsync({ name: "Gate", autonomyLevel: "manual" });
    await createWorkflowStepAsync(w.id, { name: "s1", instructions: "x", assignedAgentId: agent.id });
    const { workflowRunId } = await startWorkflowRunAsync(w.id, {});

    // First approve succeeds.
    await approveCurrentStepAsync(workflowRunId, { userId: null });

    // Simulate the racing second click — workflow_run is no longer in
    // waiting_for_approval, so the CAS guard fires.
    await expect(approveCurrentStepAsync(workflowRunId, { userId: null }))
      .rejects.toBeInstanceOf(WorkflowConflictError);
  });

  it("second concurrent reject throws WorkflowConflictError", async () => {
    const agent = await makeAgent();
    const w = await createWorkflowAsync({ name: "RejGate", autonomyLevel: "manual" });
    await createWorkflowStepAsync(w.id, { name: "s1", instructions: "x", assignedAgentId: agent.id });
    const { workflowRunId } = await startWorkflowRunAsync(w.id, {});

    await rejectWorkflowRunAsync(workflowRunId, { userId: null });
    await expect(rejectWorkflowRunAsync(workflowRunId, { userId: null }))
      .rejects.toBeInstanceOf(WorkflowConflictError);
  });
});

describe("workflow: orphan step rejection", () => {
  it("createWorkflowStepAsync rejects step with no agent or team", async () => {
    const w = await createWorkflowAsync({ name: "x" });
    await expect(
      createWorkflowStepAsync(w.id, { name: "orphan", instructions: "x" }),
    ).rejects.toThrow(/agent or team/);
  });

  it("updateWorkflowStepAsync rejects update that strips both routing targets", async () => {
    const agent = await makeAgent();
    const w = await createWorkflowAsync({ name: "x" });
    const step = await createWorkflowStepAsync(w.id, { name: "s1", instructions: "x", assignedAgentId: agent.id });
    await expect(
      updateWorkflowStepAsync(step!.id, { assignedAgentId: null }),
    ).rejects.toThrow(/agent or team/);
  });
});

describe("workflow: cross-workflow reorder rejection", () => {
  it("reorderWorkflowStepsAsync rejects step IDs from a different workflow", async () => {
    const agent = await makeAgent();
    const wA = await createWorkflowAsync({ name: "A" });
    const wB = await createWorkflowAsync({ name: "B" });
    const sA = await createWorkflowStepAsync(wA.id, { name: "a", instructions: "x", assignedAgentId: agent.id });
    const sB = await createWorkflowStepAsync(wB.id, { name: "b", instructions: "x", assignedAgentId: agent.id });
    await expect(
      reorderWorkflowStepsAsync(wA.id, [sA!.id, sB!.id]),
    ).rejects.toThrow(/do not belong/);
  });
});

describe("workflow start route: paused rejection", () => {
  it("start route returns 400 for paused workflow", async () => {
    const agent = await makeAgent();
    const { sessionId } = await makeUser("operator-start@x.com", "operator");
    const w = await createWorkflowAsync({ name: "p1" });
    await createWorkflowStepAsync(w.id, { name: "s", instructions: "x", assignedAgentId: agent.id });
    await updateWorkflowAsync(w.id, { status: "paused" });

    const req = makeReq(`http://x/api/workflows/${w.id}/start`, sessionId, {});
    const resp = await startWorkflowPOST(req, { params: Promise.resolve({ id: w.id }) });
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error).toMatch(/paused/i);
  });
});

describe("autonomy: cannot delete seeded global policy", () => {
  it("DELETE on the seeded global policy returns 400", async () => {
    const { sessionId } = await makeUser("admin-del@x.com", "admin");
    const req = makeReq(`http://x/api/autonomy/policies/ap_default_global`, sessionId, {}, "DELETE");
    const resp = await deletePolicyDELETE(req, { params: Promise.resolve({ id: "ap_default_global" }) });
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error).toMatch(/global/i);
  });
});

describe("autonomy: internal check is agent-only", () => {
  it("user caller is rejected with 403", async () => {
    const { sessionId } = await makeUser("u-internal@x.com", "operator");
    const req = makeReq(
      "http://x/api/internal/autonomy/check", sessionId,
      { runId: "fake", toolName: "send_email" },
    );
    const resp = await autonomyCheckPOST(req, { params: Promise.resolve({}) });
    expect(resp.status).toBe(403);
  });
});

describe("autonomy: setPolicyRuleAsync is idempotent under concurrent upsert", () => {
  it("two parallel sets on the same (policy, action) leave exactly one row", async () => {
    const { createPolicyAsync } = await import("@/lib/db/queries");
    const policy = await createPolicyAsync({ name: "Race", scopeType: "agent", scopeId: "a-race" });

    // Fire concurrent upserts on the same action_type. Native UPSERT means
    // both calls converge to a single row without raising.
    await Promise.all([
      setPolicyRuleAsync(policy.id, { actionType: "send_email", riskLevel: "high", requireApproval: true }),
      setPolicyRuleAsync(policy.id, { actionType: "send_email", riskLevel: "high", requireApproval: false }),
    ]);

    const rules = await listPolicyRulesAsync(policy.id);
    const matching = rules.filter(r => r.action_type === "send_email");
    expect(matching).toHaveLength(1);
  });
});
