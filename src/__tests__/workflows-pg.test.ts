/**
 * Workflows against Postgres (pg-mem). Confirms the schema initializes
 * cleanly and basic CRUD round-trips work via the async adapter.
 *
 * The full execution path (advance-on-run-status) requires invoking
 * updateRunStatusAsync, which uses real runs.scheduled_for + agent
 * polling SQL that pg-mem doesn't fully support — that path is covered
 * by the SQLite suite in workflows-core / workflows-routing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { newDb } from "pg-mem";
import { setDb, resetDb } from "@/lib/db/schema";
import { PostgresAdapter } from "@/lib/db/adapter-postgres";
import { initializePostgresSchema } from "@/lib/db/schema-postgres";
import {
  createWorkflowAsync, getWorkflowByIdAsync, updateWorkflowAsync, deleteWorkflowAsync,
  createWorkflowStepAsync, listWorkflowStepsAsync, reorderWorkflowStepsAsync,
  createAgentAsync,
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

describe("workflows via Postgres", () => {
  it("schema initializes all four workflow tables", async () => {
    for (const t of ["workflows", "workflow_steps", "workflow_runs", "workflow_step_runs", "workflow_run_activity"]) {
      const row = await adapter.get(
        `SELECT 1 AS one FROM information_schema.tables WHERE table_name = $1`, [t],
      );
      expect(row, `${t} should exist`).not.toBeNull();
    }
  });

  it("createWorkflowAsync + getWorkflowByIdAsync round-trip", async () => {
    const w = await createWorkflowAsync({ name: "PG Pipeline", department: "Engineering" });
    expect(w.id).toBeTruthy();
    expect(w.status).toBe("draft");
    expect(w.autonomy_level).toBe("supervised");
    const fetched = await getWorkflowByIdAsync(w.id);
    expect(fetched?.name).toBe("PG Pipeline");
    expect(fetched?.department).toBe("Engineering");
  });

  it("updateWorkflowAsync writes through", async () => {
    const w = await createWorkflowAsync({ name: "Update Me" });
    await updateWorkflowAsync(w.id, { status: "active", autonomyLevel: "autonomous" });
    const after = await getWorkflowByIdAsync(w.id);
    expect(after?.status).toBe("active");
    expect(after?.autonomy_level).toBe("autonomous");
  });

  it("steps round-trip + reorder", async () => {
    const agent = await createAgentAsync("PG Worker", "", { type: "harbour", cli: "claude", model: "sonnet" });
    const agentId = agent.id;
    const w = await createWorkflowAsync({ name: "Steps" });
    const s1 = await createWorkflowStepAsync(w.id, { name: "A", instructions: "x", assignedAgentId: agentId });
    const s2 = await createWorkflowStepAsync(w.id, { name: "B", instructions: "x", assignedAgentId: agentId });
    const s3 = await createWorkflowStepAsync(w.id, { name: "C", instructions: "x", assignedAgentId: agentId });
    let steps = await listWorkflowStepsAsync(w.id);
    expect(steps.map(s => s.name)).toEqual(["A", "B", "C"]);
    steps = await reorderWorkflowStepsAsync(w.id, [s3!.id, s1!.id, s2!.id]);
    expect(steps.map(s => s.name)).toEqual(["C", "A", "B"]);
  });

  it("deleteWorkflowAsync cascades to steps", async () => {
    const agent = await createAgentAsync("PG Worker 2", "", { type: "harbour", cli: "claude", model: "sonnet" });
    const agentId = agent.id;
    const w = await createWorkflowAsync({ name: "Delete Me" });
    await createWorkflowStepAsync(w.id, { name: "A", instructions: "x", assignedAgentId: agentId });
    await deleteWorkflowAsync(w.id);
    expect(await getWorkflowByIdAsync(w.id)).toBeNull();
    const steps = await listWorkflowStepsAsync(w.id);
    expect(steps.length).toBe(0);
  });
});

vi.spyOn(console, "warn").mockImplementation(() => { /* swallow pg-mem notices */ });
