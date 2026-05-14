import { getDb, getDbAsync } from "./schema";
import { nowSql } from "./dialect";
import { v4 as uuid } from "uuid";
import type {
  ActionType,
  ApprovalSourceType,
  ApprovalStatus,
  RiskLevel,
  ScopeType,
} from "../autonomy/constants";
import { isActionType, isRiskLevel } from "../autonomy/constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AutonomyPolicyRow = {
  id: string;
  name: string;
  description: string | null;
  scope_type: ScopeType;
  scope_id: string | null;
  enabled: number;
  created_at: number;
  updated_at: number;
};

export type PolicyRuleRow = {
  id: string;
  policy_id: string;
  action_type: ActionType;
  risk_level: RiskLevel;
  require_approval: number;
  max_cost_usd: number | null;
  allowed_roles: string | null;
  approval_roles: string | null;
  created_at: number;
  updated_at: number;
};

export type ApprovalRequestRow = {
  id: string;
  source_type: ApprovalSourceType;
  source_id: string;
  requested_by_agent_id: string | null;
  action_type: ActionType;
  risk_level: RiskLevel;
  reason: string | null;
  payload_json: string | null;
  status: ApprovalStatus;
  approved_by_user_id: string | null;
  approval_comment: string | null;
  created_at: number;
  resolved_at: number | null;
};

export type CreatePolicyInput = {
  name: string;
  description?: string | null;
  scopeType: ScopeType;
  scopeId?: string | null;
  enabled?: boolean;
};

export type UpdatePolicyInput = {
  name?: string;
  description?: string | null;
  enabled?: boolean;
};

export type SetRuleInput = {
  actionType: ActionType;
  riskLevel: RiskLevel;
  requireApproval?: boolean;
  maxCostUsd?: number | null;
  allowedRoles?: string[] | null;
  approvalRoles?: string[] | null;
};

export type CreateApprovalInput = {
  sourceType: ApprovalSourceType;
  sourceId: string;
  actionType: ActionType;
  riskLevel: RiskLevel;
  reason?: string | null;
  payloadJson?: string | null;
  requestedByAgentId?: string | null;
};

export type ListApprovalFilter = {
  status?: ApprovalStatus;
  sourceType?: ApprovalSourceType;
  sourceId?: string;
  limit?: number;
};

function assertActionType(v: string): asserts v is ActionType {
  if (!isActionType(v)) throw new Error(`Invalid action_type: ${v}`);
}
function assertRiskLevel(v: string): asserts v is RiskLevel {
  if (!isRiskLevel(v)) throw new Error(`Invalid risk_level: ${v}`);
}

// ---------------------------------------------------------------------------
// Sync API (SQLite only)
// ---------------------------------------------------------------------------

export function createPolicy(input: CreatePolicyInput): AutonomyPolicyRow {
  const db = getDb();
  const id = uuid();
  db.prepare(
    `INSERT INTO autonomy_policies (id, name, description, scope_type, scope_id, enabled) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.name,
    input.description ?? null,
    input.scopeType,
    input.scopeId ?? null,
    input.enabled === false ? 0 : 1,
  );
  return getPolicyById(id)!;
}

export function getPolicyById(id: string): AutonomyPolicyRow | null {
  const db = getDb();
  return (db.prepare(`SELECT * FROM autonomy_policies WHERE id = ?`).get(id) as AutonomyPolicyRow | undefined) ?? null;
}

export function listPolicies(): AutonomyPolicyRow[] {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM autonomy_policies ORDER BY scope_type, name`)
    .all() as AutonomyPolicyRow[];
}

export function updatePolicy(id: string, input: UpdatePolicyInput): AutonomyPolicyRow | null {
  const db = getDb();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  if (input.name !== undefined) { fields.push("name = ?"); values.push(input.name); }
  if (input.description !== undefined) { fields.push("description = ?"); values.push(input.description); }
  if (input.enabled !== undefined) { fields.push("enabled = ?"); values.push(input.enabled ? 1 : 0); }
  if (fields.length === 0) return getPolicyById(id);
  fields.push("updated_at = unixepoch()");
  values.push(id);
  db.prepare(`UPDATE autonomy_policies SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getPolicyById(id);
}

export function deletePolicy(id: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM autonomy_policies WHERE id = ?`).run(id);
}

export function listPolicyRules(policyId: string): PolicyRuleRow[] {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM policy_rules WHERE policy_id = ? ORDER BY action_type`)
    .all(policyId) as PolicyRuleRow[];
}

export function setPolicyRule(policyId: string, input: SetRuleInput): PolicyRuleRow {
  const db = getDb();
  assertActionType(input.actionType);
  assertRiskLevel(input.riskLevel);
  const existing = db
    .prepare(`SELECT id FROM policy_rules WHERE policy_id = ? AND action_type = ?`)
    .get(policyId, input.actionType) as { id: string } | undefined;
  const id = existing?.id ?? uuid();
  if (existing) {
    db.prepare(
      `UPDATE policy_rules SET risk_level = ?, require_approval = ?, max_cost_usd = ?, allowed_roles = ?, approval_roles = ?, updated_at = unixepoch() WHERE id = ?`,
    ).run(
      input.riskLevel,
      input.requireApproval ? 1 : 0,
      input.maxCostUsd ?? null,
      input.allowedRoles ? JSON.stringify(input.allowedRoles) : null,
      input.approvalRoles ? JSON.stringify(input.approvalRoles) : null,
      id,
    );
  } else {
    db.prepare(
      `INSERT INTO policy_rules (id, policy_id, action_type, risk_level, require_approval, max_cost_usd, allowed_roles, approval_roles) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      policyId,
      input.actionType,
      input.riskLevel,
      input.requireApproval ? 1 : 0,
      input.maxCostUsd ?? null,
      input.allowedRoles ? JSON.stringify(input.allowedRoles) : null,
      input.approvalRoles ? JSON.stringify(input.approvalRoles) : null,
    );
  }
  return (db.prepare(`SELECT * FROM policy_rules WHERE id = ?`).get(id) as PolicyRuleRow);
}

export function deletePolicyRule(policyId: string, actionType: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM policy_rules WHERE policy_id = ? AND action_type = ?`).run(policyId, actionType);
}

export function createApprovalRequest(input: CreateApprovalInput): ApprovalRequestRow {
  const db = getDb();
  const id = uuid();
  db.prepare(
    `INSERT INTO approval_requests (id, source_type, source_id, requested_by_agent_id, action_type, risk_level, reason, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.sourceType,
    input.sourceId,
    input.requestedByAgentId ?? null,
    input.actionType,
    input.riskLevel,
    input.reason ?? null,
    input.payloadJson ?? null,
  );
  return getApprovalRequestById(id)!;
}

export function getApprovalRequestById(id: string): ApprovalRequestRow | null {
  const db = getDb();
  return (
    (db.prepare(`SELECT * FROM approval_requests WHERE id = ?`).get(id) as ApprovalRequestRow | undefined) ?? null
  );
}

export function listApprovalRequests(filter: ListApprovalFilter = {}): ApprovalRequestRow[] {
  const db = getDb();
  const where: string[] = [];
  const values: (string | number)[] = [];
  if (filter.status) { where.push("status = ?"); values.push(filter.status); }
  if (filter.sourceType) { where.push("source_type = ?"); values.push(filter.sourceType); }
  if (filter.sourceId) { where.push("source_id = ?"); values.push(filter.sourceId); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limitSql = filter.limit && filter.limit > 0 ? `LIMIT ${Math.min(filter.limit, 1000)}` : "";
  return db
    .prepare(`SELECT * FROM approval_requests ${whereSql} ORDER BY created_at DESC ${limitSql}`)
    .all(...values) as ApprovalRequestRow[];
}

// ---------------------------------------------------------------------------
// Async API (works for SQLite + Postgres)
// ---------------------------------------------------------------------------

export async function createPolicyAsync(input: CreatePolicyInput): Promise<AutonomyPolicyRow> {
  const db = await getDbAsync();
  const id = uuid();
  await db.run(
    `INSERT INTO autonomy_policies (id, name, description, scope_type, scope_id, enabled) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.name,
      input.description ?? null,
      input.scopeType,
      input.scopeId ?? null,
      input.enabled === false ? 0 : 1,
    ],
  );
  return (await getPolicyByIdAsync(id))!;
}

export async function getPolicyByIdAsync(id: string): Promise<AutonomyPolicyRow | null> {
  const db = await getDbAsync();
  const row = await db.get<AutonomyPolicyRow>(`SELECT * FROM autonomy_policies WHERE id = ?`, [id]);
  return row ?? null;
}

export async function listPoliciesAsync(): Promise<AutonomyPolicyRow[]> {
  const db = await getDbAsync();
  return await db.all<AutonomyPolicyRow>(`SELECT * FROM autonomy_policies ORDER BY scope_type, name`);
}

export async function updatePolicyAsync(id: string, input: UpdatePolicyInput): Promise<AutonomyPolicyRow | null> {
  const db = await getDbAsync();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  if (input.name !== undefined) { fields.push("name = ?"); values.push(input.name); }
  if (input.description !== undefined) { fields.push("description = ?"); values.push(input.description); }
  if (input.enabled !== undefined) { fields.push("enabled = ?"); values.push(input.enabled ? 1 : 0); }
  if (fields.length === 0) return getPolicyByIdAsync(id);
  fields.push(`updated_at = ${nowSql(db)}`);
  values.push(id);
  await db.run(`UPDATE autonomy_policies SET ${fields.join(", ")} WHERE id = ?`, values);
  return getPolicyByIdAsync(id);
}

export async function deletePolicyAsync(id: string): Promise<void> {
  const db = await getDbAsync();
  await db.run(`DELETE FROM autonomy_policies WHERE id = ?`, [id]);
}

export async function listPolicyRulesAsync(policyId: string): Promise<PolicyRuleRow[]> {
  const db = await getDbAsync();
  return await db.all<PolicyRuleRow>(
    `SELECT * FROM policy_rules WHERE policy_id = ? ORDER BY action_type`,
    [policyId],
  );
}

export async function setPolicyRuleAsync(policyId: string, input: SetRuleInput): Promise<PolicyRuleRow> {
  const db = await getDbAsync();
  assertActionType(input.actionType);
  assertRiskLevel(input.riskLevel);
  // Native UPSERT on (policy_id, action_type). Works on both SQLite and PG;
  // replaces the previous read-then-write pattern that could race two
  // concurrent admin calls into a unique-constraint violation.
  const id = uuid();
  await db.run(
    `INSERT INTO policy_rules (id, policy_id, action_type, risk_level, require_approval, max_cost_usd, allowed_roles, approval_roles)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(policy_id, action_type) DO UPDATE SET
       risk_level = excluded.risk_level,
       require_approval = excluded.require_approval,
       max_cost_usd = excluded.max_cost_usd,
       allowed_roles = excluded.allowed_roles,
       approval_roles = excluded.approval_roles,
       updated_at = ${nowSql(db)}`,
    [
      id,
      policyId,
      input.actionType,
      input.riskLevel,
      input.requireApproval ? 1 : 0,
      input.maxCostUsd ?? null,
      input.allowedRoles ? JSON.stringify(input.allowedRoles) : null,
      input.approvalRoles ? JSON.stringify(input.approvalRoles) : null,
    ],
  );
  return (await db.get<PolicyRuleRow>(
    `SELECT * FROM policy_rules WHERE policy_id = ? AND action_type = ?`,
    [policyId, input.actionType],
  ))!;
}

export async function deletePolicyRuleAsync(policyId: string, actionType: string): Promise<void> {
  const db = await getDbAsync();
  await db.run(`DELETE FROM policy_rules WHERE policy_id = ? AND action_type = ?`, [policyId, actionType]);
}

export async function createApprovalRequestAsync(input: CreateApprovalInput): Promise<ApprovalRequestRow> {
  const db = await getDbAsync();
  const id = uuid();
  await db.run(
    `INSERT INTO approval_requests (id, source_type, source_id, requested_by_agent_id, action_type, risk_level, reason, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.sourceType,
      input.sourceId,
      input.requestedByAgentId ?? null,
      input.actionType,
      input.riskLevel,
      input.reason ?? null,
      input.payloadJson ?? null,
    ],
  );
  return (await getApprovalRequestByIdAsync(id))!;
}

export async function getApprovalRequestByIdAsync(id: string): Promise<ApprovalRequestRow | null> {
  const db = await getDbAsync();
  const row = await db.get<ApprovalRequestRow>(`SELECT * FROM approval_requests WHERE id = ?`, [id]);
  return row ?? null;
}

export async function listApprovalRequestsAsync(filter: ListApprovalFilter = {}): Promise<ApprovalRequestRow[]> {
  const db = await getDbAsync();
  const where: string[] = [];
  const values: (string | number)[] = [];
  if (filter.status) { where.push("status = ?"); values.push(filter.status); }
  if (filter.sourceType) { where.push("source_type = ?"); values.push(filter.sourceType); }
  if (filter.sourceId) { where.push("source_id = ?"); values.push(filter.sourceId); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = filter.limit && filter.limit > 0 ? Math.min(filter.limit, 1000) : 200;
  return await db.all<ApprovalRequestRow>(
    `SELECT * FROM approval_requests ${whereSql} ORDER BY created_at DESC LIMIT ${limit}`,
    values,
  );
}

export type ApprovalRequestWithAgent = ApprovalRequestRow & {
  requested_by_agent_name: string | null;
};

/** Same as listApprovalRequestsAsync but LEFT JOINs the agents table to
 *  include the requesting agent's display name. Drives the Approval Inbox
 *  so the operator can see who asked for the gate. */
export async function listApprovalRequestsWithAgentAsync(filter: ListApprovalFilter = {}): Promise<ApprovalRequestWithAgent[]> {
  const db = await getDbAsync();
  const where: string[] = [];
  const values: (string | number)[] = [];
  if (filter.status) { where.push("r.status = ?"); values.push(filter.status); }
  if (filter.sourceType) { where.push("r.source_type = ?"); values.push(filter.sourceType); }
  if (filter.sourceId) { where.push("r.source_id = ?"); values.push(filter.sourceId); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = filter.limit && filter.limit > 0 ? Math.min(filter.limit, 1000) : 200;
  return await db.all<ApprovalRequestWithAgent>(
    `SELECT r.*, a.name AS requested_by_agent_name
     FROM approval_requests r
     LEFT JOIN agents a ON a.id = r.requested_by_agent_id
     ${whereSql}
     ORDER BY r.created_at DESC
     LIMIT ${limit}`,
    values,
  );
}

export async function countApprovalRequestsAsync(filter: ListApprovalFilter = {}): Promise<number> {
  const db = await getDbAsync();
  const where: string[] = [];
  const values: (string | number)[] = [];
  if (filter.status) { where.push("status = ?"); values.push(filter.status); }
  if (filter.sourceType) { where.push("source_type = ?"); values.push(filter.sourceType); }
  if (filter.sourceId) { where.push("source_id = ?"); values.push(filter.sourceId); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const row = await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM approval_requests ${whereSql}`, values);
  return Number(row?.n ?? 0);
}

/**
 * Resolve a pending approval request. The status must currently be 'pending';
 * any other status returns null so concurrent clicks observe a 409 cleanly.
 */
export async function approveRequestAsync(
  id: string,
  approvedByUserId: string,
  comment?: string | null,
): Promise<ApprovalRequestRow | null> {
  return resolveApprovalAsync(id, "approved", approvedByUserId, comment);
}

export async function rejectRequestAsync(
  id: string,
  rejectedByUserId: string,
  comment?: string | null,
): Promise<ApprovalRequestRow | null> {
  return resolveApprovalAsync(id, "rejected", rejectedByUserId, comment);
}

async function resolveApprovalAsync(
  id: string,
  next: "approved" | "rejected",
  userId: string,
  comment?: string | null,
): Promise<ApprovalRequestRow | null> {
  const db = await getDbAsync();
  // CAS update guards against the simultaneous-approval race.
  const updated = await db.run(
    `UPDATE approval_requests
     SET status = ?, approved_by_user_id = ?, approval_comment = ?, resolved_at = ${nowSql(db)}
     WHERE id = ? AND status = 'pending'`,
    [next, userId, comment ?? null, id],
  );
  if (!updated || updated.changes === 0) return null;
  return getApprovalRequestByIdAsync(id);
}

/**
 * Bulk-resolve any pending approval requests whose source identifies them as
 * part of a workflow step (used when the operator approves/rejects the step
 * itself via the workflow-run page). Idempotent.
 */
export async function resolveStepApprovalsAsync(
  stepRunId: string,
  resolution: "approved" | "rejected",
  userId: string,
  comment?: string | null,
): Promise<number> {
  const db = await getDbAsync();
  const result = await db.run(
    `UPDATE approval_requests
     SET status = ?, approved_by_user_id = ?, approval_comment = ?, resolved_at = ${nowSql(db)}
     WHERE source_type = 'workflow_step' AND source_id = ? AND status = 'pending'`,
    [resolution, userId, comment ?? null, stepRunId],
  );
  return result?.changes ?? 0;
}
