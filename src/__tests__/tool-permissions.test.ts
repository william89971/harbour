/**
 * Tool-permission server-side gate.
 */
import { describe, it, expect } from "vitest";
import type { AgentAuth, UserAuth } from "@/lib/auth";
import { requireTool } from "@/lib/tool-permissions";
import { defaultToolPermissions } from "@/lib/db/queries";

function agentAuth(perms: Partial<Record<string, boolean>> = {}): AgentAuth {
  const full = {
    read_docs: true, write_docs: true,
    read_databases: true, write_databases: true,
    read_env_vars: true,
    create_runs: true, create_handoffs: true,
    post_activity: true, update_status: true,
    use_shell: true,
  };
  return {
    type: "agent",
    agentId: "a-1",
    agentName: "agent",
    toolPermissions: { ...full, ...perms } as AgentAuth["toolPermissions"],
  };
}

const userAuth: UserAuth = { type: "user", userId: "u-1", email: "x@x", displayName: "user", role: "admin" };

describe("requireTool", () => {
  it("returns null for a permitted agent", () => {
    expect(requireTool(agentAuth(), "write_docs")).toBeNull();
  });

  it("returns a 403 NextResponse for a denied agent", async () => {
    const r = requireTool(agentAuth({ write_docs: false }), "write_docs");
    expect(r).not.toBeNull();
    const json = await r!.json();
    expect(r!.status).toBe(403);
    expect(json.error).toMatch(/write_docs/);
  });

  it("always allows user callers (role gating happens elsewhere)", () => {
    expect(requireTool(userAuth, "write_docs")).toBeNull();
    expect(requireTool(userAuth, "use_shell")).toBeNull();
  });

  it("blocks output + attachments routes for agents with post_activity off", async () => {
    // Both routes gate on post_activity so an agent without that permission
    // can't smuggle data into the run via the streaming output channel or
    // by uploading an attachment.
    const denied = requireTool(agentAuth({ post_activity: false }), "post_activity");
    expect(denied).not.toBeNull();
    expect(denied!.status).toBe(403);
    const json = await denied!.json();
    expect(json.error).toMatch(/post_activity/);
  });
});

describe("defaultToolPermissions", () => {
  it("safe mode grants the minimum useful set (docs r/w + read DB + activity + status)", () => {
    const p = defaultToolPermissions("safe", "claude");
    expect(p.read_docs).toBe(true);
    expect(p.write_docs).toBe(true);
    expect(p.read_databases).toBe(true);
    expect(p.write_databases).toBe(false);
    expect(p.read_env_vars).toBe(false);
    expect(p.post_activity).toBe(true);
    expect(p.update_status).toBe(true);
    expect(p.use_shell).toBe(false);
    expect(p.create_runs).toBe(false);
    expect(p.create_handoffs).toBe(false);
  });

  it("unrestricted mode grants everything (shell on for shell-capable, off for api)", () => {
    const sh = defaultToolPermissions("unrestricted", "claude");
    expect(sh.use_shell).toBe(true);
    expect(sh.read_env_vars).toBe(true);
    const api = defaultToolPermissions("unrestricted", "api");
    expect(api.use_shell).toBe(false);
    expect(api.read_env_vars).toBe(true);
  });

  it("custom mode also defaults to everything-on (matches unrestricted)", () => {
    const c = defaultToolPermissions("custom", "shell");
    expect(c.use_shell).toBe(true);
    expect(c.read_databases).toBe(true);
  });
});
