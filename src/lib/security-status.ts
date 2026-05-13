import { agentSettingsJsonPath, agentWorkspaceSlug } from "./paths";
import { validateClaudeSettingsPath } from "./claude-settings";

export type SecurityAgent = {
  id: string;
  name: string;
  cli: string | null;
  type: string;
  permission_mode: string;
  can_use_shell?: number | boolean;
  can_read_env_vars?: number | boolean;
  can_update_status?: number | boolean;
};

export type SecurityStatus = {
  unrestrictedAgents: { id: string; name: string; cli: string | null; mode: string }[];
  customModeIssues: { id: string; name: string; mode: string; settingsJsonPath: string; error: string }[];
  workspaceCollisions: { slug: string; agents: { id: string; name: string }[] }[];
  excessivePermissions: { id: string; name: string; mode: string; flags: string[] }[];
  /** API agents whose `can_update_status` is off. They can't close runs;
   *  every run sits in `running` until timeout. Visible footgun worth a
   *  dedicated row in the Security panel. */
  apiAgentsWithoutStatus: { id: string; name: string }[];
  jobEnvVars: { count: number };
};

/**
 * Pure: takes a list of agents + the job-env-var count, returns the
 * "what's risky?" rollup that drives the Security panel and the
 * /api/system/security-status response. Extracted from the route handler
 * so it's unit-testable without mocking the next/server runtime.
 */
export function computeSecurityStatus(agents: SecurityAgent[], jobEnvVarCount: number): SecurityStatus {
  const unrestrictedAgents = agents
    .filter(a => a.type === "harbour" && a.permission_mode === "unrestricted")
    .map(a => ({ id: a.id, name: a.name, cli: a.cli, mode: a.permission_mode }));

  const customModeIssues: SecurityStatus["customModeIssues"] = [];
  for (const a of agents) {
    if (a.type !== "harbour" || a.cli !== "claude") continue;
    if (a.permission_mode === "unrestricted") continue;
    const settingsPath = agentSettingsJsonPath(a.name);
    const v = validateClaudeSettingsPath(settingsPath);
    if (!v.ok) {
      customModeIssues.push({
        id: a.id,
        name: a.name,
        mode: a.permission_mode,
        settingsJsonPath: settingsPath,
        error: v.error,
      });
    }
  }

  const bySlug = new Map<string, SecurityAgent[]>();
  for (const a of agents) {
    if (a.type !== "harbour") continue;
    const slug = agentWorkspaceSlug(a.name);
    const list = bySlug.get(slug) ?? [];
    list.push(a);
    bySlug.set(slug, list);
  }
  const workspaceCollisions = [...bySlug.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([slug, list]) => ({ slug, agents: list.map(a => ({ id: a.id, name: a.name })) }));

  const excessivePermissions: SecurityStatus["excessivePermissions"] = [];
  for (const a of agents) {
    if (a.type !== "harbour") continue;
    if (a.permission_mode !== "safe") continue;
    const flags: string[] = [];
    if (a.can_use_shell) flags.push("can_use_shell");
    if (a.can_read_env_vars) flags.push("can_read_env_vars");
    if (flags.length > 0) {
      excessivePermissions.push({ id: a.id, name: a.name, mode: a.permission_mode, flags });
    }
  }

  const apiAgentsWithoutStatus = agents
    .filter(a => a.type === "harbour" && a.cli === "api" && !a.can_update_status)
    .map(a => ({ id: a.id, name: a.name }));

  return {
    unrestrictedAgents,
    customModeIssues,
    workspaceCollisions,
    excessivePermissions,
    apiAgentsWithoutStatus,
    jobEnvVars: { count: jobEnvVarCount },
  };
}
