/**
 * Agent permission modes: safe / custom / unrestricted.
 *
 * Covers:
 *  - schema default + migration backfill
 *  - createAgent defaults (new Claude → safe; everything else → unrestricted)
 *  - validation: invalid mode rejected; safe/custom rejected for non-Claude
 *  - updateAgent enforces the same constraints
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { setDb, resetDb, initializeSchema } from "@/lib/db/schema";
import {
  createAgent, getAgentById, updateAgent,
  defaultPermissionMode, isValidPermissionMode,
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

afterEach(() => {
  resetDb();
});

describe("agent permissions: schema + defaults", () => {
  it("defaults new Claude agents to safe", () => {
    const a = createAgent("Claude Bot", "test", { type: "harbour", cli: "claude", model: "sonnet" });
    expect(a.permission_mode).toBe("safe");
    expect(getAgentById(a.id).permission_mode).toBe("safe");
  });

  it("defaults Codex/Gemini agents to unrestricted (opt-in to safe mode)", () => {
    const codex = createAgent("Codex Bot", "test", { type: "harbour", cli: "codex", model: "gpt-5.5" });
    expect(codex.permission_mode).toBe("unrestricted");
    const gemini = createAgent("Gemini Bot", "test", { type: "harbour", cli: "gemini", model: "gemini-2.5-pro" });
    expect(gemini.permission_mode).toBe("unrestricted");
  });

  it("defaults new API agents to safe", () => {
    const a = createAgent("DeepSeek Bot", "test", {
      type: "harbour", cli: "api", model: "deepseek-chat",
      apiBaseUrl: "https://api.deepseek.com/v1", apiKeyEnv: "DEEPSEEK_API_KEY",
    });
    expect(a.permission_mode).toBe("safe");
    expect(a.api_base_url).toBe("https://api.deepseek.com/v1");
    expect(a.api_key_env).toBe("DEEPSEEK_API_KEY");
  });

  it("accepts safe mode on Codex/Gemini/Shell now (Harbour-level soft sandbox)", () => {
    expect(() => createAgent("Codex Safe", "", {
      type: "harbour", cli: "codex", model: "gpt-5.5", permissionMode: "safe",
    })).not.toThrow();
    expect(() => createAgent("Gemini Safe", "", {
      type: "harbour", cli: "gemini", model: "gemini-2.5-pro", permissionMode: "safe",
    })).not.toThrow();
  });

  it("defaults external + shell agents to unrestricted", () => {
    const ext = createAgent("External", "test", { type: "external" });
    expect(ext.permission_mode).toBe("unrestricted");
    const shell = createAgent("Shell", "test", { type: "harbour", cli: "shell", shellCommand: "/bin/true" });
    expect(shell.permission_mode).toBe("unrestricted");
  });

  it("respects an explicit permission mode on Claude agents", () => {
    const a = createAgent("Custom Claude", "", { type: "harbour", cli: "claude", model: "sonnet", permissionMode: "custom" });
    expect(a.permission_mode).toBe("custom");
    const b = createAgent("Unsafe Claude", "", { type: "harbour", cli: "claude", model: "sonnet", permissionMode: "unrestricted" });
    expect(b.permission_mode).toBe("unrestricted");
  });

  it("simulates the migration backfill: rows added with no permission_mode get 'unrestricted'", () => {
    // Emulate an existing row that predates the column.
    const db = new Database(":memory:");
    setDb(db);
    db.exec(`
      CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        api_key_hash TEXT NOT NULL,
        max_concurrent_runs INTEGER NOT NULL DEFAULT 1,
        shell_command TEXT,
        shell_cwd TEXT,
        last_polled_at INTEGER,
        type TEXT NOT NULL DEFAULT 'external',
        cli TEXT,
        model TEXT,
        thinking TEXT,
        remote INTEGER NOT NULL DEFAULT 0,
        eager INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
    `);
    db.prepare(`INSERT INTO agents (id, name, api_key_hash) VALUES ('old1', 'Legacy', 'hash1')`).run();
    db.prepare(`INSERT INTO agents (id, name, api_key_hash, cli, type) VALUES ('old2', 'Legacy Claude', 'hash2', 'claude', 'harbour')`).run();
    // Run the schema initializer, which adds permission_mode with the backfill default.
    initializeSchema(db);
    const row1 = db.prepare(`SELECT permission_mode, can_read_docs, can_write_docs, can_use_shell FROM agents WHERE id = ?`).get("old1") as Record<string, number | string>;
    const row2 = db.prepare(`SELECT permission_mode, can_read_docs, can_write_docs, can_use_shell FROM agents WHERE id = ?`).get("old2") as Record<string, number | string>;
    expect(row1.permission_mode).toBe("unrestricted");
    expect(row2.permission_mode).toBe("unrestricted");
    // Tool permissions backfill to ALL-ON for existing rows.
    expect(row1.can_read_docs).toBe(1);
    expect(row1.can_write_docs).toBe(1);
    expect(row1.can_use_shell).toBe(1);
    expect(row2.can_read_docs).toBe(1);
  });
});

describe("agent permissions: validation", () => {
  it("rejects invalid mode strings on create", () => {
    expect(() => createAgent("Bad", "", {
      type: "harbour", cli: "claude", model: "sonnet",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      permissionMode: "nuclear" as any,
    })).toThrow(/invalid permission_mode/);
  });

  it("rejects safe/custom for external agents (Harbour doesn't spawn them)", () => {
    expect(() => createAgent("External Safe", "", { type: "external", permissionMode: "safe" }))
      .toThrow(/only valid for harbour agents/);
  });

  it("rejects API agents missing apiBaseUrl or apiKeyEnv", () => {
    expect(() => createAgent("Bad API", "", { type: "harbour", cli: "api", model: "deepseek-chat" }))
      .toThrow(/apiBaseUrl is required/);
    expect(() => createAgent("Bad API 2", "", {
      type: "harbour", cli: "api", model: "deepseek-chat", apiBaseUrl: "https://x/v1",
    })).toThrow(/apiKeyEnv is required/);
  });

  it("rejects apiBaseUrl on non-api CLIs", () => {
    expect(() => createAgent("Confused", "", {
      type: "harbour", cli: "claude", model: "sonnet", apiBaseUrl: "https://x/v1",
    })).toThrow(/only valid for cli='api'/);
  });

  it("allows transitioning a Claude agent through all three modes", () => {
    const a = createAgent("Claude", "", { type: "harbour", cli: "claude", model: "sonnet" });
    expect(a.permission_mode).toBe("safe");
    updateAgent(a.id, { permissionMode: "custom" });
    expect(getAgentById(a.id).permission_mode).toBe("custom");
    updateAgent(a.id, { permissionMode: "unrestricted" });
    expect(getAgentById(a.id).permission_mode).toBe("unrestricted");
    updateAgent(a.id, { permissionMode: "safe" });
    expect(getAgentById(a.id).permission_mode).toBe("safe");
  });
});

describe("tool permissions on the agents table", () => {
  it("new agents get the safe-default tool set", () => {
    const a = createAgent("API Safe", "", {
      type: "harbour", cli: "api", model: "deepseek-chat",
      apiBaseUrl: "https://x/v1", apiKeyEnv: "X_KEY",
    });
    const row = getAgentById(a.id);
    expect(row.tool_permissions.read_docs).toBe(true);
    expect(row.tool_permissions.write_docs).toBe(true);
    expect(row.tool_permissions.read_databases).toBe(true);
    expect(row.tool_permissions.write_databases).toBe(false);
    expect(row.tool_permissions.read_env_vars).toBe(false);
    expect(row.tool_permissions.post_activity).toBe(true);
    expect(row.tool_permissions.update_status).toBe(true);
    expect(row.tool_permissions.create_runs).toBe(false);
    expect(row.tool_permissions.use_shell).toBe(false);
  });

  it("explicit toolPermissions on createAgent overlay onto the default", () => {
    const a = createAgent("Custom Tools", "", {
      type: "harbour", cli: "claude", model: "sonnet",
      toolPermissions: { write_databases: true, use_shell: false },
    });
    const row = getAgentById(a.id);
    expect(row.tool_permissions.write_databases).toBe(true);
    expect(row.tool_permissions.use_shell).toBe(false);
    expect(row.tool_permissions.read_docs).toBe(true);
  });

  it("updateAgent toggles individual flags", () => {
    const a = createAgent("Toggler", "", { type: "harbour", cli: "claude", model: "sonnet" });
    updateAgent(a.id, { toolPermissions: { write_databases: true } });
    const row = getAgentById(a.id);
    expect(row.tool_permissions.write_databases).toBe(true);
    expect(row.tool_permissions.read_docs).toBe(true);
  });

  it("rejects unknown tool names", () => {
    const a = createAgent("Bad Tool", "", { type: "harbour", cli: "claude", model: "sonnet" });
    expect(() => updateAgent(a.id, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toolPermissions: { nuke: true } as any,
    })).toThrow(/unknown tool permission/);
  });
});

describe("agent permissions: helpers", () => {
  it("isValidPermissionMode accepts the three modes and nothing else", () => {
    expect(isValidPermissionMode("safe")).toBe(true);
    expect(isValidPermissionMode("custom")).toBe(true);
    expect(isValidPermissionMode("unrestricted")).toBe(true);
    expect(isValidPermissionMode("nuclear")).toBe(false);
    expect(isValidPermissionMode(undefined)).toBe(false);
    expect(isValidPermissionMode(null)).toBe(false);
  });

  it("defaultPermissionMode picks safe for new Claude agents only", () => {
    expect(defaultPermissionMode("claude", "harbour")).toBe("safe");
    expect(defaultPermissionMode("codex", "harbour")).toBe("unrestricted");
    expect(defaultPermissionMode("gemini", "harbour")).toBe("unrestricted");
    expect(defaultPermissionMode("shell", "harbour")).toBe("unrestricted");
    expect(defaultPermissionMode(null, "external")).toBe("unrestricted");
  });
});
