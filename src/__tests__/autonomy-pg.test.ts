/**
 * Autonomy schema + CRUD round-trip on Postgres (pg-mem). Confirms the
 * tables initialize, the default policy is seeded, and rule upserts work
 * via the async adapter. The richer state-machine tests live in the
 * SQLite suite because pg-mem doesn't fully model SELECT ... FOR UPDATE.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { newDb } from "pg-mem";
import { setDb, resetDb } from "@/lib/db/schema";
import { PostgresAdapter } from "@/lib/db/adapter-postgres";
import { initializePostgresSchema } from "@/lib/db/schema-postgres";
import {
  createPolicyAsync, listPoliciesAsync, listPolicyRulesAsync, setPolicyRuleAsync,
  createApprovalRequestAsync, listApprovalRequestsAsync,
} from "@/lib/db/queries";

function createMemAdapter(): PostgresAdapter {
  const mem = newDb({ autoCreateForeignKeyIndices: true });
  const { Pool } = mem.adapters.createPg();
  const pool = new Pool() as unknown as import("pg").Pool;
  return new PostgresAdapter(pool);
}

let adapter: PostgresAdapter;

beforeEach(async () => {
  adapter = createMemAdapter();
  await initializePostgresSchema(adapter);
  setDb(adapter);
});

afterEach(async () => {
  resetDb();
  await adapter.close().catch(() => { /* noop */ });
});

describe("autonomy via Postgres", () => {
  it("schema initializes all three autonomy tables", async () => {
    for (const t of ["autonomy_policies", "policy_rules", "approval_requests"]) {
      const row = await adapter.get(
        `SELECT 1 AS one FROM information_schema.tables WHERE table_name = $1`, [t],
      );
      expect(row, `${t} should exist`).not.toBeNull();
    }
  });

  it("default global policy is seeded on init", async () => {
    const policies = await listPoliciesAsync();
    expect(policies.filter(p => p.scope_type === "global")).toHaveLength(1);
  });

  it("createPolicyAsync + setPolicyRuleAsync round-trip", async () => {
    const p = await createPolicyAsync({ name: "PG-Eng", scopeType: "department", scopeId: "Eng" });
    const rule = await setPolicyRuleAsync(p.id, { actionType: "deploy_code", riskLevel: "high", requireApproval: true });
    expect(rule.policy_id).toBe(p.id);
    const rules = await listPolicyRulesAsync(p.id);
    expect(rules.find(r => r.action_type === "deploy_code")?.require_approval).toBe(1);
  });

  it("createApprovalRequestAsync writes and listApprovalRequestsAsync reads", async () => {
    const req = await createApprovalRequestAsync({
      sourceType: "tool_call", sourceId: "run-pg-1",
      actionType: "send_email", riskLevel: "high", reason: "test",
    });
    const pending = await listApprovalRequestsAsync({ status: "pending" });
    expect(pending.map(r => r.id)).toContain(req.id);
  });
});

vi.spyOn(console, "warn").mockImplementation(() => { /* swallow pg-mem notices */ });
