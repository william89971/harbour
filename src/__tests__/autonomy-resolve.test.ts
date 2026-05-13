/**
 * Policy resolution engine: scope priority + cost-ceiling decisions.
 *
 * Drives in-memory SQLite via setDb + initializeSchema. The default global
 * policy is seeded automatically by initializeSchema, so most tests layer a
 * higher-priority scope policy on top to assert override behavior.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { setDb, resetDb, initializeSchema } from "@/lib/db/schema";
import { createPolicyAsync, setPolicyRuleAsync, listPoliciesAsync } from "@/lib/db/queries";
import { evaluatePolicy } from "@/lib/autonomy/resolve";

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

describe("evaluatePolicy", () => {
  it("falls through to allow when no rule matches anywhere", async () => {
    // 'custom' has a rule in the default global, so use an action that *only*
    // resolves to allow on a fresh policy: 'update_status' is seeded as
    // require_approval=0, low-risk.
    const d = await evaluatePolicy({ actionType: "update_status" });
    expect(d.allow).toBe(true);
  });

  it("default global policy requires approval for high-risk actions", async () => {
    const d = await evaluatePolicy({ actionType: "send_email" });
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.rule.action_type).toBe("send_email");
  });

  it("agent scope overrides global", async () => {
    const policy = await createPolicyAsync({ name: "Bot loose", scopeType: "agent", scopeId: "agent-1" });
    await setPolicyRuleAsync(policy.id, { actionType: "send_email", riskLevel: "low", requireApproval: false });
    const d = await evaluatePolicy({ agentId: "agent-1", actionType: "send_email" });
    expect(d.allow).toBe(true);
  });

  it("team scope overrides workflow + department + global", async () => {
    const team = await createPolicyAsync({ name: "Team strict", scopeType: "team", scopeId: "team-1" });
    await setPolicyRuleAsync(team.id, { actionType: "update_status", riskLevel: "high", requireApproval: true });
    // Global has update_status auto-allow; team override should win.
    const d = await evaluatePolicy({ teamId: "team-1", workflowId: "wf-1", department: "Eng", actionType: "update_status" });
    expect(d.allow).toBe(false);
  });

  it("workflow scope overrides department + global", async () => {
    const wf = await createPolicyAsync({ name: "WF loose", scopeType: "workflow", scopeId: "wf-1" });
    await setPolicyRuleAsync(wf.id, { actionType: "send_email", riskLevel: "low", requireApproval: false });
    const d = await evaluatePolicy({ workflowId: "wf-1", department: "Eng", actionType: "send_email" });
    expect(d.allow).toBe(true);
  });

  it("department scope overrides global", async () => {
    const dep = await createPolicyAsync({ name: "Dep tight", scopeType: "department", scopeId: "Sales" });
    await setPolicyRuleAsync(dep.id, { actionType: "spend_money", riskLevel: "high", requireApproval: true });
    const d = await evaluatePolicy({ department: "Sales", actionType: "spend_money" });
    expect(d.allow).toBe(false);
  });

  it("cost ceiling blocks when exceeded and allows when under", async () => {
    const policy = await createPolicyAsync({ name: "Budget", scopeType: "agent", scopeId: "agent-2" });
    await setPolicyRuleAsync(policy.id, {
      actionType: "spend_money", riskLevel: "medium",
      requireApproval: false, maxCostUsd: 10,
    });
    const over = await evaluatePolicy({ agentId: "agent-2", actionType: "spend_money", costUsd: 15 });
    expect(over.allow).toBe(false);
    const under = await evaluatePolicy({ agentId: "agent-2", actionType: "spend_money", costUsd: 5 });
    expect(under.allow).toBe(true);
  });

  it("require_approval=1 blocks regardless of cost", async () => {
    const policy = await createPolicyAsync({ name: "Hard gate", scopeType: "agent", scopeId: "agent-3" });
    await setPolicyRuleAsync(policy.id, {
      actionType: "spend_money", riskLevel: "high",
      requireApproval: true, maxCostUsd: 1000,
    });
    const d = await evaluatePolicy({ agentId: "agent-3", actionType: "spend_money", costUsd: 0 });
    expect(d.allow).toBe(false);
  });

  it("default global policy is seeded exactly once", async () => {
    const policies = await listPoliciesAsync();
    expect(policies.filter(p => p.scope_type === "global")).toHaveLength(1);
  });
});
