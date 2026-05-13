/**
 * Postgres adapter integration test (via pg-mem). This is the proof-of-concept
 * for the dual-backend rollout: settings.ts is the first module migrated to
 * the async adapter, and this suite proves the same code path that
 * `/api/settings/route.ts` uses works end-to-end against a Postgres dialect
 * via the `getDbAsync()` handle.
 *
 * pg-mem is an in-process Postgres simulator — not 100% feature-parity with
 * real PG (notably row-level locking semantics) but covers SQL dialect,
 * placeholder rewriting, transactions, ON CONFLICT, etc.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { newDb } from "pg-mem";
import { setDb, resetDb } from "@/lib/db/schema";
import { PostgresAdapter } from "@/lib/db/adapter-postgres";
import { initializePostgresSchema } from "@/lib/db/schema-postgres";
import { getSettingAsync, setSettingAsync, getAllSettingsAsync } from "@/lib/db/settings";

/** Stand up a pg-mem-backed adapter that satisfies the same shape as
 *  `createPostgresAdapter(url)`. We wire its `pool.query` through pg-mem's
 *  query function and reuse the existing PostgresAdapter machinery so the
 *  placeholder + unixepoch() rewrites are exercised. */
function createMemAdapter(): PostgresAdapter {
  const mem = newDb({ autoCreateForeignKeyIndices: true });
  // pg-mem ships an adapter that mimics node-postgres's Pool/Client surface.
  const { Pool } = mem.adapters.createPg();
  const pool = new Pool() as unknown as import("pg").Pool;
  return new PostgresAdapter(pool);
}

describe("Postgres adapter via pg-mem", () => {
  let adapter: PostgresAdapter;

  beforeEach(async () => {
    adapter = createMemAdapter();
    // Only need the settings table for this POC — no default-timestamp columns
    // so pg-mem handles it directly without function registration.
    await adapter.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    setDb(adapter);
  });

  afterEach(async () => {
    resetDb();
    await adapter.close().catch(() => { /* pg-mem pools don't need shutdown */ });
  });

  it("dialect is reported as postgres", () => {
    expect(adapter.dialect).toBe("postgres");
  });

  it("setSettingAsync round-trips through getSettingAsync", async () => {
    await setSettingAsync("timezone", "America/Los_Angeles");
    const v = await getSettingAsync("timezone");
    expect(v).toBe("America/Los_Angeles");
  });

  it("setSettingAsync upserts on conflict (idempotent)", async () => {
    await setSettingAsync("captain_cli", "claude");
    await setSettingAsync("captain_cli", "codex");
    const v = await getSettingAsync("captain_cli");
    expect(v).toBe("codex");
  });

  it("getAllSettingsAsync returns the full map", async () => {
    await setSettingAsync("a", "1");
    await setSettingAsync("b", "2");
    const all = await getAllSettingsAsync();
    expect(all).toEqual({ a: "1", b: "2" });
  });

  it("placeholder rewriting handles multi-param queries", async () => {
    // setSettingAsync uses 2 placeholders; verify both bound positionally.
    await setSettingAsync("k1", "v1");
    await setSettingAsync("k2", "v2");
    expect(await getSettingAsync("k1")).toBe("v1");
    expect(await getSettingAsync("k2")).toBe("v2");
  });
});

describe("Postgres adapter: full schema initialization (pg-mem)", () => {
  it("initializePostgresSchema runs without errors against pg-mem", async () => {
    const adapter = createMemAdapter();
    try {
      await initializePostgresSchema(adapter);
      // Spot-check a few tables exist
      const settings = await adapter.get(`SELECT 1 AS one FROM information_schema.tables WHERE table_name = 'settings'`);
      expect(settings).not.toBeNull();
      const runs = await adapter.get(`SELECT 1 AS one FROM information_schema.tables WHERE table_name = 'runs'`);
      expect(runs).not.toBeNull();
      const runCosts = await adapter.get(`SELECT 1 AS one FROM information_schema.tables WHERE table_name = 'run_costs'`);
      expect(runCosts).not.toBeNull();
    } finally {
      await adapter.close().catch(() => { /* noop */ });
    }
  });
});

// Silence pg-mem's optional features warnings during test runs
vi.spyOn(console, "warn").mockImplementation(() => { /* swallow */ });
