import { getDb, getDbAsync } from "./schema";
import { nowSql } from "./dialect";
import { v4 as uuid } from "uuid";

export type TeamRole = "researcher" | "builder" | "reviewer" | "debugger" | "custom";

export const TEAM_ROLES: TeamRole[] = ["researcher", "builder", "reviewer", "debugger", "custom"];

export function isValidTeamRole(role: string): role is TeamRole {
  return (TEAM_ROLES as string[]).includes(role);
}

export type TeamRow = {
  id: string;
  name: string;
  description: string | null;
  created_at: number;
  updated_at: number;
};

export type TeamAgentRow = {
  team_id: string;
  agent_id: string;
  agent_name: string;
  role: TeamRole;
  custom_role: string | null;
  created_at: number;
};

/** Normalize + validate role inputs. Throws on unknown role or missing custom_role. */
function normalizeRole(role: unknown, customRole: unknown): { role: TeamRole; custom_role: string | null } {
  const r = String(role || "custom").toLowerCase();
  if (!isValidTeamRole(r)) {
    throw new Error(`Invalid role: "${r}". Must be one of: ${TEAM_ROLES.join(", ")}`);
  }
  const custom = customRole == null ? null : String(customRole).trim() || null;
  if (r === "custom" && !custom) {
    throw new Error('Custom role requires a non-empty custom_role value');
  }
  if (r !== "custom" && custom) {
    // Non-custom roles ignore custom_role; null it out for cleanliness.
    return { role: r, custom_role: null };
  }
  return { role: r, custom_role: custom };
}

// ---------------------------------------------------------------------------
// Sync API (legacy — SQLite only)
// ---------------------------------------------------------------------------

export function createTeam(name: string, description?: string): TeamRow {
  const db = getDb();
  const id = uuid();
  db.prepare(`INSERT INTO teams (id, name, description) VALUES (?, ?, ?)`).run(id, name, description || null);
  return getTeamById(id)!;
}

export function getTeamById(id: string): TeamRow | null {
  const db = getDb();
  return db.prepare(`SELECT * FROM teams WHERE id = ?`).get(id) as TeamRow | undefined || null;
}

export function listTeams(): TeamRow[] {
  const db = getDb();
  return db.prepare(`
    SELECT t.*,
      (SELECT COUNT(*) FROM team_agents WHERE team_id = t.id) as member_count,
      (SELECT COUNT(*) FROM jobs WHERE team_id = t.id) as job_count
    FROM teams t ORDER BY t.name
  `).all() as TeamRow[];
}

export function updateTeam(id: string, data: { name?: string; description?: string }): TeamRow | null {
  const db = getDb();
  const fields: string[] = [];
  const values: (string | null)[] = [];
  if (data.name !== undefined) { fields.push("name = ?"); values.push(data.name); }
  if (data.description !== undefined) { fields.push("description = ?"); values.push(data.description); }
  if (fields.length === 0) return getTeamById(id);
  fields.push("updated_at = unixepoch()");
  values.push(id);
  db.prepare(`UPDATE teams SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getTeamById(id);
}

export function deleteTeam(id: string) {
  const db = getDb();
  db.prepare(`DELETE FROM teams WHERE id = ?`).run(id);
}

export function addAgentToTeam(teamId: string, agentId: string, role: string = "custom", customRole?: string) {
  const db = getDb();
  const norm = normalizeRole(role, customRole);
  db.prepare(
    `INSERT INTO team_agents (team_id, agent_id, role, custom_role) VALUES (?, ?, ?, ?)
     ON CONFLICT(team_id, agent_id) DO UPDATE SET role = excluded.role, custom_role = excluded.custom_role`,
  ).run(teamId, agentId, norm.role, norm.custom_role);
}

export function removeAgentFromTeam(teamId: string, agentId: string) {
  const db = getDb();
  db.prepare(`DELETE FROM team_agents WHERE team_id = ? AND agent_id = ?`).run(teamId, agentId);
}

export function setAgentRoleInTeam(teamId: string, agentId: string, role: string, customRole?: string) {
  const db = getDb();
  const norm = normalizeRole(role, customRole);
  db.prepare(`UPDATE team_agents SET role = ?, custom_role = ? WHERE team_id = ? AND agent_id = ?`)
    .run(norm.role, norm.custom_role, teamId, agentId);
}

export function listAgentsInTeam(teamId: string): TeamAgentRow[] {
  const db = getDb();
  return db.prepare(`
    SELECT ta.team_id, ta.agent_id, ta.role, ta.custom_role, ta.created_at, a.name as agent_name
    FROM team_agents ta
    JOIN agents a ON a.id = ta.agent_id
    WHERE ta.team_id = ?
    ORDER BY a.name
  `).all(teamId) as TeamAgentRow[];
}

export function listTeamsForAgent(agentId: string): (TeamRow & { role: TeamRole; custom_role: string | null })[] {
  const db = getDb();
  return db.prepare(`
    SELECT t.*, ta.role, ta.custom_role
    FROM teams t
    JOIN team_agents ta ON ta.team_id = t.id
    WHERE ta.agent_id = ?
    ORDER BY t.name
  `).all(agentId) as (TeamRow & { role: TeamRole; custom_role: string | null })[];
}

// ---------------------------------------------------------------------------
// Async variants — cross-backend (SQLite + Postgres) via the adapter layer.
// ---------------------------------------------------------------------------

export async function createTeamAsync(name: string, description?: string): Promise<TeamRow> {
  const db = await getDbAsync();
  const id = uuid();
  await db.run(`INSERT INTO teams (id, name, description) VALUES (?, ?, ?)`, [id, name, description || null]);
  const row = await getTeamByIdAsync(id);
  return row!;
}

export async function getTeamByIdAsync(id: string): Promise<TeamRow | null> {
  const db = await getDbAsync();
  return db.get<TeamRow>(`SELECT * FROM teams WHERE id = ?`, [id]);
}

export async function listTeamsAsync() {
  const db = await getDbAsync();
  return db.all(`
    SELECT t.*,
      (SELECT COUNT(*) FROM team_agents WHERE team_id = t.id) as member_count,
      (SELECT COUNT(*) FROM jobs WHERE team_id = t.id) as job_count
    FROM teams t ORDER BY t.name
  `);
}

export async function updateTeamAsync(id: string, data: { name?: string; description?: string }): Promise<TeamRow | null> {
  const db = await getDbAsync();
  const fields: string[] = [];
  const values: (string | null)[] = [];
  if (data.name !== undefined) { fields.push("name = ?"); values.push(data.name); }
  if (data.description !== undefined) { fields.push("description = ?"); values.push(data.description); }
  if (fields.length === 0) return getTeamByIdAsync(id);
  fields.push(`updated_at = ${nowSql(db)}`);
  values.push(id);
  await db.run(`UPDATE teams SET ${fields.join(", ")} WHERE id = ?`, values);
  return getTeamByIdAsync(id);
}

export async function deleteTeamAsync(id: string) {
  const db = await getDbAsync();
  await db.run(`DELETE FROM teams WHERE id = ?`, [id]);
}

export async function addAgentToTeamAsync(teamId: string, agentId: string, role: string = "custom", customRole?: string) {
  const db = await getDbAsync();
  const norm = normalizeRole(role, customRole);
  await db.run(
    `INSERT INTO team_agents (team_id, agent_id, role, custom_role) VALUES (?, ?, ?, ?)
     ON CONFLICT (team_id, agent_id) DO UPDATE SET role = excluded.role, custom_role = excluded.custom_role`,
    [teamId, agentId, norm.role, norm.custom_role],
  );
}

export async function removeAgentFromTeamAsync(teamId: string, agentId: string) {
  const db = await getDbAsync();
  await db.run(`DELETE FROM team_agents WHERE team_id = ? AND agent_id = ?`, [teamId, agentId]);
}

export async function setAgentRoleInTeamAsync(teamId: string, agentId: string, role: string, customRole?: string) {
  const db = await getDbAsync();
  const norm = normalizeRole(role, customRole);
  await db.run(
    `UPDATE team_agents SET role = ?, custom_role = ? WHERE team_id = ? AND agent_id = ?`,
    [norm.role, norm.custom_role, teamId, agentId],
  );
}

export async function listAgentsInTeamAsync(teamId: string): Promise<TeamAgentRow[]> {
  const db = await getDbAsync();
  return db.all<TeamAgentRow>(`
    SELECT ta.team_id, ta.agent_id, ta.role, ta.custom_role, ta.created_at, a.name as agent_name
    FROM team_agents ta
    JOIN agents a ON a.id = ta.agent_id
    WHERE ta.team_id = ?
    ORDER BY a.name
  `, [teamId]);
}

export async function listTeamsForAgentAsync(agentId: string): Promise<(TeamRow & { role: TeamRole; custom_role: string | null })[]> {
  const db = await getDbAsync();
  return db.all<TeamRow & { role: TeamRole; custom_role: string | null }>(`
    SELECT t.*, ta.role, ta.custom_role
    FROM teams t
    JOIN team_agents ta ON ta.team_id = t.id
    WHERE ta.agent_id = ?
    ORDER BY t.name
  `, [agentId]);
}

/** Aggregate run counts across all agents in a team. Used by team detail pages. */
export async function teamRunCountsAsync(teamId: string) {
  const db = await getDbAsync();
  const row = await db.get<{ running: number; waiting: number; pending: number; failed: number; done: number }>(`
    SELECT
      COALESCE(SUM(CASE WHEN r.status = 'running' THEN 1 ELSE 0 END), 0) as running,
      COALESCE(SUM(CASE WHEN r.status = 'waiting' THEN 1 ELSE 0 END), 0) as waiting,
      COALESCE(SUM(CASE WHEN r.status = 'pending' THEN 1 ELSE 0 END), 0) as pending,
      COALESCE(SUM(CASE WHEN r.status = 'failed' THEN 1 ELSE 0 END), 0) as failed,
      COALESCE(SUM(CASE WHEN r.status = 'done' THEN 1 ELSE 0 END), 0) as done
    FROM runs r
    JOIN team_agents ta ON ta.agent_id = r.agent_id
    WHERE ta.team_id = ?
  `, [teamId]);
  return row || { running: 0, waiting: 0, pending: 0, failed: 0, done: 0 };
}
