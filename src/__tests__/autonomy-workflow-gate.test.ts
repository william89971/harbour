/**
 * Workflow-step gating driven by autonomy policies: a step with no explicit
 * approval that still trips a policy rule pauses for human approval and
 * records an approval_request.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { setDb, resetDb, initializeSchema } from "@/lib/db/schema";
import {
  createAgentAsync, createUserAsync,
  createWorkflowAsync, createWorkflowStepAsync,
  startWorkflowRunAsync,
  getWorkflowRunByIdAsync, listWorkflowStepRunsAsync,
  approveCurrentStepAsync, rejectWorkflowRunAsync,
  createPolicyAsync, setPolicyRuleAsync,
  listApprovalRequestsAsync,
} from "@/lib/db/queries";

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
async function makeUser(email = "approver@example.com") {
  return createUserAsync(email, "test-pw-1!!", "Approver");
}

describe("workflow step gated by autonomy policy", () => {
  it("policy requires approval for a non-risky step → step pauses with approval_request", async () => {
    const agent = await makeAgent();
    const w = await createWorkflowAsync({ name: "Gated", autonomyLevel: "autonomous" });
    await createWorkflowStepAsync(w.id, { name: "do thing", instructions: "x", assignedAgentId: agent.id });

    // Force update_status to require approval at the agent scope. The default
    // global policy has update_status auto-allow, so this proves agent > global.
    const policy = await createPolicyAsync({ name: "Lockdown", scopeType: "agent", scopeId: agent.id });
    await setPolicyRuleAsync(policy.id, { actionType: "update_status", riskLevel: "high", requireApproval: true });

    const { workflowRunId, firstStepRunId } = await startWorkflowRunAsync(w.id, {});
    const wr = await getWorkflowRunByIdAsync(workflowRunId);
    expect(wr?.status).toBe("waiting_for_approval");

    const stepRuns = await listWorkflowStepRunsAsync(workflowRunId);
    expect(stepRuns[0].status).toBe("waiting_approval_before");

    const pending = await listApprovalRequestsAsync({ status: "pending", sourceType: "workflow_step", sourceId: firstStepRunId });
    expect(pending).toHaveLength(1);
    expect(pending[0].action_type).toBe("update_status");
  });

  it("approve resolves the linked approval_request to 'approved'", async () => {
    const agent = await makeAgent();
    const user = await makeUser();
    const w = await createWorkflowAsync({ name: "Gated2", autonomyLevel: "autonomous" });
    await createWorkflowStepAsync(w.id, { name: "s1", instructions: "x", assignedAgentId: agent.id });
    const policy = await createPolicyAsync({ name: "L2", scopeType: "agent", scopeId: agent.id });
    await setPolicyRuleAsync(policy.id, { actionType: "update_status", riskLevel: "high", requireApproval: true });

    const { workflowRunId, firstStepRunId } = await startWorkflowRunAsync(w.id, {});
    await approveCurrentStepAsync(workflowRunId, { userId: user!.id, userName: "Approver" });

    const resolved = await listApprovalRequestsAsync({ sourceType: "workflow_step", sourceId: firstStepRunId });
    expect(resolved[0].status).toBe("approved");
    expect(resolved[0].approved_by_user_id).toBe(user!.id);
  });

  it("reject resolves the linked approval_request to 'rejected'", async () => {
    const agent = await makeAgent();
    const user = await makeUser("reject@example.com");
    const w = await createWorkflowAsync({ name: "Gated3", autonomyLevel: "autonomous" });
    await createWorkflowStepAsync(w.id, { name: "s1", instructions: "x", assignedAgentId: agent.id });
    const policy = await createPolicyAsync({ name: "L3", scopeType: "agent", scopeId: agent.id });
    await setPolicyRuleAsync(policy.id, { actionType: "update_status", riskLevel: "high", requireApproval: true });

    const { workflowRunId, firstStepRunId } = await startWorkflowRunAsync(w.id, {});
    await rejectWorkflowRunAsync(workflowRunId, { userId: user!.id, userName: "Reject", comment: "no" });

    const resolved = await listApprovalRequestsAsync({ sourceType: "workflow_step", sourceId: firstStepRunId });
    expect(resolved[0].status).toBe("rejected");
  });

  it("default global policy does not pause a normal non-risky step (regression guard)", async () => {
    const agent = await makeAgent();
    const w = await createWorkflowAsync({ name: "Normal", autonomyLevel: "autonomous" });
    await createWorkflowStepAsync(w.id, { name: "ok", instructions: "x", assignedAgentId: agent.id });

    const { workflowRunId } = await startWorkflowRunAsync(w.id, {});
    const wr = await getWorkflowRunByIdAsync(workflowRunId);
    expect(wr?.status).toBe("running");
  });
});
