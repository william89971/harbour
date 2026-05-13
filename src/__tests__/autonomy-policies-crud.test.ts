/**
 * Policy + rule CRUD round-trips. Covers default-policy seeding, upserts on
 * (policy_id, action_type), and cascade-on-delete.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { setDb, resetDb, initializeSchema } from "@/lib/db/schema";
import {
  createPolicyAsync, listPoliciesAsync, getPolicyByIdAsync, updatePolicyAsync, deletePolicyAsync,
  setPolicyRuleAsync, listPolicyRulesAsync,
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

describe("autonomy policies CRUD", () => {
  it("seeds a single global policy on first init", async () => {
    const policies = await listPoliciesAsync();
    const global = policies.filter(p => p.scope_type === "global");
    expect(global).toHaveLength(1);
    expect(global[0].name).toBe("Default Safety Policy");
    const rules = await listPolicyRulesAsync(global[0].id);
    expect(rules.length).toBeGreaterThan(5);
  });

  it("creates a scope-specific policy and reads it back", async () => {
    const p = await createPolicyAsync({ name: "Marketing", scopeType: "department", scopeId: "Marketing" });
    expect(p.scope_type).toBe("department");
    expect(p.scope_id).toBe("Marketing");
    expect(p.enabled).toBe(1);
    const fetched = await getPolicyByIdAsync(p.id);
    expect(fetched?.name).toBe("Marketing");
  });

  it("updatePolicyAsync writes through", async () => {
    const p = await createPolicyAsync({ name: "Eng", scopeType: "department", scopeId: "Eng" });
    await updatePolicyAsync(p.id, { name: "Engineering", enabled: false });
    const after = await getPolicyByIdAsync(p.id);
    expect(after?.name).toBe("Engineering");
    expect(after?.enabled).toBe(0);
  });

  it("setPolicyRuleAsync upserts by (policy_id, action_type)", async () => {
    const p = await createPolicyAsync({ name: "X", scopeType: "agent", scopeId: "a-1" });
    const r1 = await setPolicyRuleAsync(p.id, { actionType: "send_email", riskLevel: "high", requireApproval: true });
    const r2 = await setPolicyRuleAsync(p.id, { actionType: "send_email", riskLevel: "low", requireApproval: false });
    expect(r1.id).toBe(r2.id);
    expect(r2.risk_level).toBe("low");
    const rules = await listPolicyRulesAsync(p.id);
    expect(rules.filter(r => r.action_type === "send_email")).toHaveLength(1);
  });

  it("deletePolicyAsync cascades rules", async () => {
    const p = await createPolicyAsync({ name: "Y", scopeType: "team", scopeId: "t-1" });
    await setPolicyRuleAsync(p.id, { actionType: "deploy_code", riskLevel: "high", requireApproval: true });
    await deletePolicyAsync(p.id);
    expect(await getPolicyByIdAsync(p.id)).toBeNull();
    const rules = await listPolicyRulesAsync(p.id);
    expect(rules).toHaveLength(0);
  });

  it("rejects unknown action_type at the DB helper", async () => {
    const p = await createPolicyAsync({ name: "Z", scopeType: "agent", scopeId: "a-2" });
    await expect(
      setPolicyRuleAsync(p.id, { actionType: "not_real" as never, riskLevel: "high" }),
    ).rejects.toThrow(/Invalid action_type/);
  });
});
