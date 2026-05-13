import { getDb, getDbAsync } from "./schema";
import { nowSql } from "./dialect";
import { v4 as uuid } from "uuid";
import crypto from "crypto";
import { deleteRunAttachmentsDir } from "./attachments";

type AgentRow = {
  id: string; name: string; description: string | null; type: string;
  cli: string | null; model: string | null; thinking: string | null;
  remote: number; eager: number; max_concurrent_runs: number;
  shell_command: string | null; shell_cwd: string | null;
  permission_mode: PermissionMode;
  api_base_url: string | null;
  api_key_env: string | null;
  can_read_docs: number; can_write_docs: number;
  can_read_databases: number; can_write_databases: number;
  can_read_env_vars: number;
  can_create_runs: number; can_create_handoffs: number;
  can_post_activity: number; can_update_status: number;
  can_use_shell: number;
  last_polled_at: number | null; created_at: number; updated_at: number;
};

export type PermissionMode = "safe" | "custom" | "unrestricted";
export const PERMISSION_MODES: PermissionMode[] = ["safe", "custom", "unrestricted"];

export function isValidPermissionMode(mode: unknown): mode is PermissionMode {
  return typeof mode === "string" && (PERMISSION_MODES as string[]).includes(mode);
}

/** Canonical tool-permission names. Used as columns on the agents table
 *  (with `can_` prefix), keys on AgentAuth.toolPermissions, and function
 *  names exposed to API agents in their function-calling tool spec. */
export const TOOL_NAMES = [
  "read_docs", "write_docs",
  "read_databases", "write_databases",
  "read_env_vars",
  "create_runs", "create_handoffs",
  "post_activity", "update_status",
  "use_shell",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];
export type ToolPermissions = Record<ToolName, boolean>;

export function isValidToolName(name: unknown): name is ToolName {
  return typeof name === "string" && (TOOL_NAMES as readonly string[]).includes(name);
}

export function toolColumn(t: ToolName): string {
  return `can_${t}`;
}

/** Map the agents.can_* columns into a flat ToolPermissions object. */
export function rowToToolPermissions(row: {
  can_read_docs?: number | boolean; can_write_docs?: number | boolean;
  can_read_databases?: number | boolean; can_write_databases?: number | boolean;
  can_read_env_vars?: number | boolean;
  can_create_runs?: number | boolean; can_create_handoffs?: number | boolean;
  can_post_activity?: number | boolean; can_update_status?: number | boolean;
  can_use_shell?: number | boolean;
}): ToolPermissions {
  return {
    read_docs: !!row.can_read_docs,
    write_docs: !!row.can_write_docs,
    read_databases: !!row.can_read_databases,
    write_databases: !!row.can_write_databases,
    read_env_vars: !!row.can_read_env_vars,
    create_runs: !!row.can_create_runs,
    create_handoffs: !!row.can_create_handoffs,
    post_activity: !!row.can_post_activity,
    update_status: !!row.can_update_status,
    use_shell: !!row.can_use_shell,
  };
}

/** Default tool permissions for a freshly created agent. Existing agents
 *  migrate with all-on (preserves behavior); new agents pick by mode + cli.
 *  Safe-mode defaults are minimal: docs read/write, databases read, activity,
 *  status. Shell defaults on for shell-capable providers; api agents never
 *  get shell. */
export function defaultToolPermissions(mode: PermissionMode, cli: string | null | undefined): ToolPermissions {
  if (mode === "unrestricted" || mode === "custom") {
    return {
      read_docs: true, write_docs: true,
      read_databases: true, write_databases: true,
      read_env_vars: true,
      create_runs: true, create_handoffs: true,
      post_activity: true, update_status: true,
      use_shell: cli !== "api",
    };
  }
  return {
    read_docs: true, write_docs: true,
    read_databases: true, write_databases: false,
    read_env_vars: false,
    create_runs: false, create_handoffs: false,
    post_activity: true, update_status: true,
    use_shell: false,
  };
}

/** Permission modes are valid for every harbour agent (Claude has the
 *  richest enforcement; other CLIs get Harbour-level safe mode via shim
 *  PATH wrappers; API agents have no shell to begin with). External
 *  agents — Harbour doesn't spawn them, so mode is informational. */
export function isModeAllowedForCli(mode: PermissionMode, _cli: string | null | undefined, type: string): PermissionMode {
  if (mode === "unrestricted") return mode;
  if (type !== "harbour") {
    throw new Error("permission_mode 'safe' and 'custom' are only valid for harbour agents");
  }
  return mode;
}

/** Default mode for a freshly created agent. New Claude and API agents
 *  default to safe; other shell-capable CLIs default to unrestricted so
 *  the user has to opt into Harbour-level (soft-sandbox) safe mode
 *  consciously. */
export function defaultPermissionMode(cli: string | null | undefined, type: string): PermissionMode {
  if (type !== "harbour") return "unrestricted";
  if (cli === "claude" || cli === "api") return "safe";
  return "unrestricted";
}

/** Clamp + validate a max_concurrent_runs value to 1..10. */
function clampMaxConcurrentRuns(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 1 || v > 10) {
    throw new Error("max_concurrent_runs must be an integer between 1 and 10");
  }
  return Math.floor(v);
}
export { clampMaxConcurrentRuns };

function generateApiKey(): string {
  return "hbr_" + crypto.randomBytes(32).toString("hex");
}

function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export type CreateAgentOpts = {
  type?: string; cli?: string; model?: string; thinking?: string;
  remote?: boolean; eager?: boolean;
  maxConcurrentRuns?: number;
  shellCommand?: string | null; shellCwd?: string | null;
  permissionMode?: PermissionMode;
  apiBaseUrl?: string | null;
  apiKeyEnv?: string | null;
  toolPermissions?: Partial<ToolPermissions>;
};

/** Validate the api-agent fields. Throws on missing or mismatched values. */
function validateApiAgentFields(cli: string | null, type: string, apiBaseUrl: string | null, apiKeyEnv: string | null, model: string | null) {
  if (cli === "api") {
    if (type !== "harbour") throw new Error("API agents must have type='harbour'");
    if (!apiBaseUrl || !apiBaseUrl.trim()) throw new Error("apiBaseUrl is required for API agents");
    if (!apiKeyEnv || !apiKeyEnv.trim()) throw new Error("apiKeyEnv is required for API agents");
    if (!model || !model.trim()) throw new Error("model is required for API agents");
  } else {
    if (apiBaseUrl || apiKeyEnv) {
      throw new Error("apiBaseUrl and apiKeyEnv are only valid for cli='api'");
    }
  }
}

/** Merge a partial tool-permissions override over the default for this
 *  mode/cli. Unknown keys throw. */
function resolveToolPermissions(mode: PermissionMode, cli: string | null, override?: Partial<ToolPermissions>): ToolPermissions {
  const base = defaultToolPermissions(mode, cli);
  if (!override) return base;
  for (const k of Object.keys(override)) {
    if (!isValidToolName(k)) throw new Error(`unknown tool permission: ${k}`);
  }
  return { ...base, ...override };
}

function permsToColumns(perms: ToolPermissions) {
  return {
    can_read_docs: perms.read_docs ? 1 : 0,
    can_write_docs: perms.write_docs ? 1 : 0,
    can_read_databases: perms.read_databases ? 1 : 0,
    can_write_databases: perms.write_databases ? 1 : 0,
    can_read_env_vars: perms.read_env_vars ? 1 : 0,
    can_create_runs: perms.create_runs ? 1 : 0,
    can_create_handoffs: perms.create_handoffs ? 1 : 0,
    can_post_activity: perms.post_activity ? 1 : 0,
    can_update_status: perms.update_status ? 1 : 0,
    can_use_shell: perms.use_shell ? 1 : 0,
  };
}

export function createAgent(name: string, description?: string, opts?: CreateAgentOpts) {
  const db = getDb();
  const id = uuid();
  const apiKey = generateApiKey();
  const apiKeyHash = hashApiKey(apiKey);
  const type = opts?.type || "external";
  const cli = opts?.cli || null;
  const model = opts?.model || null;
  const thinking = opts?.thinking || null;
  const remote = opts?.remote ? 1 : 0;
  const eager = opts?.eager ? 1 : 0;
  const maxConcurrentRuns = opts?.maxConcurrentRuns !== undefined ? clampMaxConcurrentRuns(opts.maxConcurrentRuns) : 1;
  const shellCommand = opts?.shellCommand || null;
  const shellCwd = opts?.shellCwd || null;
  const apiBaseUrl = opts?.apiBaseUrl ?? null;
  const apiKeyEnv = opts?.apiKeyEnv ?? null;
  validateApiAgentFields(cli, type, apiBaseUrl, apiKeyEnv, model);
  const requestedMode = opts?.permissionMode ?? defaultPermissionMode(cli, type);
  if (!isValidPermissionMode(requestedMode)) throw new Error(`invalid permission_mode: ${requestedMode}`);
  const permissionMode = isModeAllowedForCli(requestedMode, cli, type);
  const perms = resolveToolPermissions(permissionMode, cli, opts?.toolPermissions);
  const c = permsToColumns(perms);
  db.prepare(
    `INSERT INTO agents (
      id, name, description, api_key_hash,
      type, cli, model, thinking, remote, eager,
      max_concurrent_runs, shell_command, shell_cwd, permission_mode,
      api_base_url, api_key_env,
      can_read_docs, can_write_docs,
      can_read_databases, can_write_databases,
      can_read_env_vars,
      can_create_runs, can_create_handoffs,
      can_post_activity, can_update_status, can_use_shell
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, name, description || null, apiKeyHash,
    type, cli, model, thinking, remote, eager,
    maxConcurrentRuns, shellCommand, shellCwd, permissionMode,
    apiBaseUrl, apiKeyEnv,
    c.can_read_docs, c.can_write_docs,
    c.can_read_databases, c.can_write_databases,
    c.can_read_env_vars,
    c.can_create_runs, c.can_create_handoffs,
    c.can_post_activity, c.can_update_status, c.can_use_shell,
  );
  return {
    id, name, description, apiKey,
    type, cli, model, thinking,
    remote: !!remote, eager: !!eager,
    max_concurrent_runs: maxConcurrentRuns,
    shell_command: shellCommand, shell_cwd: shellCwd,
    permission_mode: permissionMode,
    api_base_url: apiBaseUrl, api_key_env: apiKeyEnv,
    tool_permissions: perms,
  };
}

export function authenticateAgent(apiKey: string) {
  const db = getDb();
  const hash = hashApiKey(apiKey);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agent = db.prepare(`SELECT id, name, description,
    can_read_docs, can_write_docs,
    can_read_databases, can_write_databases,
    can_read_env_vars,
    can_create_runs, can_create_handoffs,
    can_post_activity, can_update_status, can_use_shell
    FROM agents WHERE api_key_hash = ?`).get(hash) as any;
  if (!agent) return null;
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    tool_permissions: rowToToolPermissions(agent),
  };
}

export function rotateAgentKey(agentId: string) {
  const db = getDb();
  const apiKey = generateApiKey();
  const apiKeyHash = hashApiKey(apiKey);
  db.prepare(`UPDATE agents SET api_key_hash = ?, updated_at = unixepoch() WHERE id = ?`).run(apiKeyHash, agentId);
  return apiKey;
}

export function getAgentById(id: string) {
  const db = getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = db.prepare(`SELECT id, name, description, type, cli, model, thinking, remote, eager, max_concurrent_runs, shell_command, shell_cwd, permission_mode, api_base_url, api_key_env,
      can_read_docs, can_write_docs, can_read_databases, can_write_databases, can_read_env_vars, can_create_runs, can_create_handoffs, can_post_activity, can_update_status, can_use_shell,
      last_polled_at, created_at, updated_at FROM agents WHERE id = ?`).get(id) as any;
  if (!row) return null;
  row.tool_permissions = rowToToolPermissions(row);
  return row;
}

export function listAgents(projectId?: string) {
  const db = getDb();
  if (projectId) {
    return db.prepare(`
      SELECT a.id, a.name, a.description, a.type, a.cli, a.model, a.thinking, a.remote, a.eager, a.max_concurrent_runs, a.permission_mode, a.api_base_url, a.api_key_env,
      a.can_read_docs, a.can_write_docs, a.can_read_databases, a.can_write_databases, a.can_read_env_vars, a.can_create_runs, a.can_create_handoffs, a.can_post_activity, a.can_update_status, a.can_use_shell,
      a.last_polled_at, a.created_at,
        (SELECT COUNT(*) FROM jobs WHERE agent_id = a.id) as job_count,
        (SELECT COUNT(*) FROM runs WHERE agent_id = a.id AND status = 'waiting') as waiting_count,
        (SELECT COUNT(*) FROM runs WHERE agent_id = a.id AND status = 'pending') as pending_count,
        (SELECT COUNT(*) FROM runs WHERE agent_id = a.id AND status = 'running') as running_count,
        (SELECT MAX(created_at) FROM runs WHERE agent_id = a.id) as last_activity
      FROM agents a
      WHERE a.id IN (SELECT agent_id FROM project_agents WHERE project_id = ?)
      ORDER BY a.name
    `).all(projectId);
  }
  return db.prepare(`
    SELECT a.id, a.name, a.description, a.type, a.cli, a.model, a.thinking, a.remote, a.eager, a.max_concurrent_runs, a.permission_mode, a.api_base_url, a.api_key_env,
      a.can_read_docs, a.can_write_docs, a.can_read_databases, a.can_write_databases, a.can_read_env_vars, a.can_create_runs, a.can_create_handoffs, a.can_post_activity, a.can_update_status, a.can_use_shell,
      a.last_polled_at, a.created_at,
      (SELECT COUNT(*) FROM jobs WHERE agent_id = a.id) as job_count,
      (SELECT COUNT(*) FROM runs WHERE agent_id = a.id AND status = 'waiting') as waiting_count,
      (SELECT COUNT(*) FROM runs WHERE agent_id = a.id AND status = 'pending') as pending_count,
      (SELECT COUNT(*) FROM runs WHERE agent_id = a.id AND status = 'running') as running_count,
      (SELECT MAX(created_at) FROM runs WHERE agent_id = a.id) as last_activity
    FROM agents a ORDER BY a.name
  `).all();
}

export type UpdateAgentOpts = {
  name?: string; description?: string;
  cli?: string; model?: string; thinking?: string;
  eager?: boolean; maxConcurrentRuns?: number;
  shellCommand?: string | null; shellCwd?: string | null;
  permissionMode?: PermissionMode;
  apiBaseUrl?: string | null;
  apiKeyEnv?: string | null;
  toolPermissions?: Partial<ToolPermissions>;
};

export function updateAgent(id: string, data: UpdateAgentOpts) {
  const db = getDb();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  if (data.name !== undefined) { fields.push("name = ?"); values.push(data.name); }
  if (data.description !== undefined) { fields.push("description = ?"); values.push(data.description); }
  if (data.cli !== undefined) { fields.push("cli = ?"); values.push(data.cli); }
  if (data.model !== undefined) { fields.push("model = ?"); values.push(data.model); }
  if (data.thinking !== undefined) { fields.push("thinking = ?"); values.push(data.thinking || null); }
  if (data.eager !== undefined) { fields.push("eager = ?"); values.push(data.eager ? 1 : 0); }
  if (data.maxConcurrentRuns !== undefined) { fields.push("max_concurrent_runs = ?"); values.push(clampMaxConcurrentRuns(data.maxConcurrentRuns)); }
  if (data.shellCommand !== undefined) { fields.push("shell_command = ?"); values.push(data.shellCommand || null); }
  if (data.shellCwd !== undefined) { fields.push("shell_cwd = ?"); values.push(data.shellCwd || null); }
  if (data.permissionMode !== undefined) {
    if (!isValidPermissionMode(data.permissionMode)) throw new Error(`invalid permission_mode: ${data.permissionMode}`);
    const existing = getAgentById(id) as AgentRow | null;
    if (!existing) throw new Error("agent not found");
    isModeAllowedForCli(data.permissionMode, data.cli ?? existing.cli, existing.type);
    fields.push("permission_mode = ?");
    values.push(data.permissionMode);
  }
  if (data.apiBaseUrl !== undefined) { fields.push("api_base_url = ?"); values.push(data.apiBaseUrl || null); }
  if (data.apiKeyEnv !== undefined) { fields.push("api_key_env = ?"); values.push(data.apiKeyEnv || null); }
  if (data.toolPermissions !== undefined) {
    for (const k of Object.keys(data.toolPermissions)) {
      if (!isValidToolName(k)) throw new Error(`unknown tool permission: ${k}`);
    }
    for (const [k, v] of Object.entries(data.toolPermissions)) {
      fields.push(`${toolColumn(k as ToolName)} = ?`);
      values.push(v ? 1 : 0);
    }
  }
  if (fields.length === 0) return getAgentById(id);
  fields.push("updated_at = unixepoch()");
  values.push(id);
  db.prepare(`UPDATE agents SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getAgentById(id);
}

export function deleteAgent(id: string) {
  const db = getDb();
  // Capture run ids first so we can clean their on-disk attachment dirs after cascade
  const runIds = db.prepare(`SELECT id FROM runs WHERE agent_id = ?`).all(id) as { id: string }[];
  db.prepare(`DELETE FROM agents WHERE id = ?`).run(id);
  for (const r of runIds) deleteRunAttachmentsDir(r.id);
}

export function touchAgentPolled(id: string) {
  const db = getDb();
  db.prepare(`UPDATE agents SET last_polled_at = unixepoch() WHERE id = ?`).run(id);
}

// ---------------------------------------------------------------------------
// Async variants — cross-backend (SQLite + Postgres) via the adapter layer.
// ---------------------------------------------------------------------------

export async function createAgentAsync(name: string, description?: string, opts?: CreateAgentOpts) {
  const db = await getDbAsync();
  const id = uuid();
  const apiKey = generateApiKey();
  const apiKeyHash = hashApiKey(apiKey);
  const type = opts?.type || "external";
  const cli = opts?.cli || null;
  const model = opts?.model || null;
  const thinking = opts?.thinking || null;
  const remote = opts?.remote ? 1 : 0;
  const eager = opts?.eager ? 1 : 0;
  const maxConcurrentRuns = opts?.maxConcurrentRuns !== undefined ? clampMaxConcurrentRuns(opts.maxConcurrentRuns) : 1;
  const shellCommand = opts?.shellCommand || null;
  const shellCwd = opts?.shellCwd || null;
  const apiBaseUrl = opts?.apiBaseUrl ?? null;
  const apiKeyEnv = opts?.apiKeyEnv ?? null;
  validateApiAgentFields(cli, type, apiBaseUrl, apiKeyEnv, model);
  const requestedMode = opts?.permissionMode ?? defaultPermissionMode(cli, type);
  if (!isValidPermissionMode(requestedMode)) throw new Error(`invalid permission_mode: ${requestedMode}`);
  const permissionMode = isModeAllowedForCli(requestedMode, cli, type);
  const perms = resolveToolPermissions(permissionMode, cli, opts?.toolPermissions);
  const c = permsToColumns(perms);
  await db.run(
    `INSERT INTO agents (
      id, name, description, api_key_hash,
      type, cli, model, thinking, remote, eager,
      max_concurrent_runs, shell_command, shell_cwd, permission_mode,
      api_base_url, api_key_env,
      can_read_docs, can_write_docs,
      can_read_databases, can_write_databases,
      can_read_env_vars,
      can_create_runs, can_create_handoffs,
      can_post_activity, can_update_status, can_use_shell
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, name, description || null, apiKeyHash,
      type, cli, model, thinking, remote, eager,
      maxConcurrentRuns, shellCommand, shellCwd, permissionMode,
      apiBaseUrl, apiKeyEnv,
      c.can_read_docs, c.can_write_docs,
      c.can_read_databases, c.can_write_databases,
      c.can_read_env_vars,
      c.can_create_runs, c.can_create_handoffs,
      c.can_post_activity, c.can_update_status, c.can_use_shell,
    ],
  );
  return {
    id, name, description, apiKey,
    type, cli, model, thinking,
    remote: !!remote, eager: !!eager,
    max_concurrent_runs: maxConcurrentRuns,
    shell_command: shellCommand, shell_cwd: shellCwd,
    permission_mode: permissionMode,
    api_base_url: apiBaseUrl, api_key_env: apiKeyEnv,
    tool_permissions: perms,
  };
}

export async function authenticateAgentAsync(apiKey: string) {
  const db = await getDbAsync();
  const row = await db.get<AgentRow>(
    `SELECT id, name, description,
       can_read_docs, can_write_docs,
       can_read_databases, can_write_databases,
       can_read_env_vars,
       can_create_runs, can_create_handoffs,
       can_post_activity, can_update_status, can_use_shell
     FROM agents WHERE api_key_hash = ?`,
    [hashApiKey(apiKey)],
  );
  if (!row) return null;
  return { id: row.id, name: row.name, description: row.description, tool_permissions: rowToToolPermissions(row) };
}

export async function rotateAgentKeyAsync(agentId: string): Promise<string> {
  const db = await getDbAsync();
  const apiKey = generateApiKey();
  const apiKeyHash = hashApiKey(apiKey);
  await db.run(`UPDATE agents SET api_key_hash = ?, updated_at = ${nowSql(db)} WHERE id = ?`, [apiKeyHash, agentId]);
  return apiKey;
}

export async function getAgentByIdAsync(id: string) {
  const db = await getDbAsync();
  const row = await db.get<AgentRow>(
    `SELECT id, name, description, type, cli, model, thinking, remote, eager, max_concurrent_runs, shell_command, shell_cwd, permission_mode, api_base_url, api_key_env,
      can_read_docs, can_write_docs, can_read_databases, can_write_databases, can_read_env_vars, can_create_runs, can_create_handoffs, can_post_activity, can_update_status, can_use_shell,
      last_polled_at, created_at, updated_at FROM agents WHERE id = ?`,
    [id],
  );
  if (!row) return null;
  return Object.assign(row, { tool_permissions: rowToToolPermissions(row) });
}

export async function listAgentsAsync(projectId?: string) {
  const db = await getDbAsync();
  const projectFilter = projectId ? `WHERE a.id IN (SELECT agent_id FROM project_agents WHERE project_id = ?)` : "";
  const args = projectId ? [projectId] : [];
  return db.all(`
    SELECT a.id, a.name, a.description, a.type, a.cli, a.model, a.thinking, a.remote, a.eager, a.max_concurrent_runs, a.permission_mode, a.api_base_url, a.api_key_env,
      a.can_read_docs, a.can_write_docs, a.can_read_databases, a.can_write_databases, a.can_read_env_vars, a.can_create_runs, a.can_create_handoffs, a.can_post_activity, a.can_update_status, a.can_use_shell,
      a.last_polled_at, a.created_at,
      (SELECT COUNT(*) FROM jobs WHERE agent_id = a.id) as job_count,
      (SELECT COUNT(*) FROM runs WHERE agent_id = a.id AND status = 'waiting') as waiting_count,
      (SELECT COUNT(*) FROM runs WHERE agent_id = a.id AND status = 'pending') as pending_count,
      (SELECT COUNT(*) FROM runs WHERE agent_id = a.id AND status = 'running') as running_count,
      (SELECT MAX(created_at) FROM runs WHERE agent_id = a.id) as last_activity
    FROM agents a
    ${projectFilter}
    ORDER BY a.name
  `, args);
}

export async function updateAgentAsync(id: string, data: UpdateAgentOpts) {
  const db = await getDbAsync();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  if (data.name !== undefined) { fields.push("name = ?"); values.push(data.name); }
  if (data.description !== undefined) { fields.push("description = ?"); values.push(data.description); }
  if (data.cli !== undefined) { fields.push("cli = ?"); values.push(data.cli); }
  if (data.model !== undefined) { fields.push("model = ?"); values.push(data.model); }
  if (data.thinking !== undefined) { fields.push("thinking = ?"); values.push(data.thinking || null); }
  if (data.eager !== undefined) { fields.push("eager = ?"); values.push(data.eager ? 1 : 0); }
  if (data.maxConcurrentRuns !== undefined) { fields.push("max_concurrent_runs = ?"); values.push(clampMaxConcurrentRuns(data.maxConcurrentRuns)); }
  if (data.shellCommand !== undefined) { fields.push("shell_command = ?"); values.push(data.shellCommand || null); }
  if (data.shellCwd !== undefined) { fields.push("shell_cwd = ?"); values.push(data.shellCwd || null); }
  if (data.permissionMode !== undefined) {
    if (!isValidPermissionMode(data.permissionMode)) throw new Error(`invalid permission_mode: ${data.permissionMode}`);
    const existing = await getAgentByIdAsync(id);
    if (!existing) throw new Error("agent not found");
    isModeAllowedForCli(data.permissionMode, data.cli ?? existing.cli, existing.type);
    fields.push("permission_mode = ?");
    values.push(data.permissionMode);
  }
  if (data.apiBaseUrl !== undefined) { fields.push("api_base_url = ?"); values.push(data.apiBaseUrl || null); }
  if (data.apiKeyEnv !== undefined) { fields.push("api_key_env = ?"); values.push(data.apiKeyEnv || null); }
  if (data.toolPermissions !== undefined) {
    for (const k of Object.keys(data.toolPermissions)) {
      if (!isValidToolName(k)) throw new Error(`unknown tool permission: ${k}`);
    }
    for (const [k, v] of Object.entries(data.toolPermissions)) {
      fields.push(`${toolColumn(k as ToolName)} = ?`);
      values.push(v ? 1 : 0);
    }
  }
  if (fields.length === 0) return getAgentByIdAsync(id);
  fields.push(`updated_at = ${nowSql(db)}`);
  values.push(id);
  await db.run(`UPDATE agents SET ${fields.join(", ")} WHERE id = ?`, values);
  return getAgentByIdAsync(id);
}

export async function deleteAgentAsync(id: string) {
  const db = await getDbAsync();
  const runIds = await db.all<{ id: string }>(`SELECT id FROM runs WHERE agent_id = ?`, [id]);
  await db.run(`DELETE FROM agents WHERE id = ?`, [id]);
  for (const r of runIds) deleteRunAttachmentsDir(r.id);
}

export async function touchAgentPolledAsync(id: string) {
  const db = await getDbAsync();
  await db.run(`UPDATE agents SET last_polled_at = ${nowSql(db)} WHERE id = ?`, [id]);
}
