/**
 * Tests for the computeSecurityStatus rollup that drives the Security
 * panel on /settings. Pure-function test — no Next.js runtime, no DB.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { computeSecurityStatus } from "@/lib/security-status";

let originalHome: string | undefined;
let tmpHome: string;

beforeEach(() => {
  originalHome = process.env.HARBOUR_HOME;
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "harbour-secstatus-"));
  process.env.HARBOUR_HOME = tmpHome;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HARBOUR_HOME;
  else process.env.HARBOUR_HOME = originalHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("computeSecurityStatus", () => {
  it("flags harbour agents whose mode is unrestricted", () => {
    const s = computeSecurityStatus(
      [
        { id: "1", name: "Risky", cli: "claude", type: "harbour", permission_mode: "unrestricted" },
        { id: "2", name: "Sandboxed", cli: "claude", type: "harbour", permission_mode: "safe" },
        { id: "3", name: "External", cli: null, type: "external", permission_mode: "unrestricted" },
      ],
      0,
    );
    expect(s.unrestrictedAgents.map(a => a.id)).toEqual(["1"]);
  });

  it("flags safe-mode Claude agents whose settings.json is missing", () => {
    const s = computeSecurityStatus(
      [{ id: "1", name: "Sandboxed", cli: "claude", type: "harbour", permission_mode: "safe" }],
      0,
    );
    expect(s.customModeIssues).toHaveLength(1);
    expect(s.customModeIssues[0].error).toMatch(/missing/);
    expect(s.customModeIssues[0].settingsJsonPath).toContain("/workspaces/sandboxed/.claude/settings.json");
  });

  it("does not flag safe-mode agents with a valid settings.json", () => {
    const dir = path.join(tmpHome, "workspaces", "sandboxed", ".claude");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ permissions: { defaultMode: "dontAsk" } }));
    const s = computeSecurityStatus(
      [{ id: "1", name: "Sandboxed", cli: "claude", type: "harbour", permission_mode: "safe" }],
      0,
    );
    expect(s.customModeIssues).toHaveLength(0);
  });

  it("detects two agents whose names slugify to the same workspace dir", () => {
    const s = computeSecurityStatus(
      [
        { id: "1", name: "Repo Cleaner", cli: "claude", type: "harbour", permission_mode: "safe" },
        { id: "2", name: "repo cleaner", cli: "claude", type: "harbour", permission_mode: "safe" },
        { id: "3", name: "Lonely", cli: "claude", type: "harbour", permission_mode: "safe" },
      ],
      0,
    );
    expect(s.workspaceCollisions).toHaveLength(1);
    expect(s.workspaceCollisions[0].slug).toBe("repo-cleaner");
    expect(s.workspaceCollisions[0].agents.map(a => a.id).sort()).toEqual(["1", "2"]);
  });

  it("reports the job env-var count verbatim", () => {
    const s = computeSecurityStatus([], 7);
    expect(s.jobEnvVars.count).toBe(7);
  });

  it("flags API agents with update_status disabled", () => {
    const s = computeSecurityStatus(
      [
        { id: "1", name: "Mute API", cli: "api", type: "harbour", permission_mode: "safe", can_update_status: 0 },
        { id: "2", name: "Working API", cli: "api", type: "harbour", permission_mode: "safe", can_update_status: 1 },
        // Non-API agents with update_status off are NOT in this list —
        // they have their own degradation path.
        { id: "3", name: "Quiet Claude", cli: "claude", type: "harbour", permission_mode: "safe", can_update_status: 0 },
      ],
      0,
    );
    expect(s.apiAgentsWithoutStatus.map(a => a.id)).toEqual(["1"]);
  });

  it("flags safe-mode agents whose can_use_shell or can_read_env_vars is enabled", () => {
    const s = computeSecurityStatus(
      [
        // safe-mode agent with shell enabled — flagged
        { id: "1", name: "Safe-but-shell", cli: "codex", type: "harbour", permission_mode: "safe", can_use_shell: 1, can_read_env_vars: 0 },
        // safe-mode agent with env-var read — flagged with that single flag
        { id: "2", name: "Safe-envread", cli: "claude", type: "harbour", permission_mode: "safe", can_use_shell: 0, can_read_env_vars: 1 },
        // unrestricted agent — not flagged here (it's already in the unrestricted list)
        { id: "3", name: "Open", cli: "codex", type: "harbour", permission_mode: "unrestricted", can_use_shell: 1, can_read_env_vars: 1 },
        // safe-mode clean agent — not flagged
        { id: "4", name: "Clean", cli: "claude", type: "harbour", permission_mode: "safe", can_use_shell: 0, can_read_env_vars: 0 },
      ],
      0,
    );
    expect(s.excessivePermissions).toHaveLength(2);
    expect(s.excessivePermissions.find(e => e.id === "1")?.flags).toEqual(["can_use_shell"]);
    expect(s.excessivePermissions.find(e => e.id === "2")?.flags).toEqual(["can_read_env_vars"]);
  });

  it("ignores external agents in unrestricted-agents and collision detection", () => {
    const s = computeSecurityStatus(
      [
        { id: "1", name: "X", cli: null, type: "external", permission_mode: "unrestricted" },
        { id: "2", name: "X", cli: null, type: "external", permission_mode: "unrestricted" },
      ],
      0,
    );
    expect(s.unrestrictedAgents).toHaveLength(0);
    expect(s.workspaceCollisions).toHaveLength(0);
  });
});
