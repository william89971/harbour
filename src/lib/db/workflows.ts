/**
 * Workflows ("Company OS"): ordered pipelines of steps with optional
 * human approval gates. Workflows orchestrate the existing job/run
 * machinery — every step, when its turn comes, creates a one-off job +
 * run pair and waits for that run to terminate. The advancement hook is
 * called from updateRunStatusAsync (runs.ts).
 *
 * This module ships async-first (every route is already async). A thin
 * sync surface is exported for in-test SQLite convenience.
 */

import { getDb, getDbAsync } from "./schema";
import { nowSql } from "./dialect";
import { v4 as uuid } from "uuid";
import {
  requiresBeforeApproval, requiresAfterApproval,
  type AutonomyLevel,
} from "./workflow-helpers";
import { evaluatePolicy, type Decision } from "../autonomy/resolve";
import { createApprovalRequestAsync, resolveStepApprovalsAsync } from "./autonomy";
import type { ActionType } from "../autonomy/constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkflowStatus = "draft" | "active" | "paused" | "archived";
export type WorkflowRunStatus = "running" | "waiting_for_approval" | "done" | "failed" | "rejected";
export type StepRunStatus =
  | "pending" | "waiting_approval_before" | "running" | "waiting_approval_after"
  | "done" | "failed" | "skipped" | "rejected" | "needs_changes";

export type WorkflowRow = {
  id: string;
  name: string;
  description: string | null;
  department: string | null;
  status: WorkflowStatus;
  autonomy_level: AutonomyLevel;
  created_at: number;
  updated_at: number;
};

export type WorkflowStepRow = {
  id: string;
  workflow_id: string;
  step_order: number;
  name: string;
  description: string | null;
  instructions: string;
  assigned_agent_id: string | null;
  assigned_team_id: string | null;
  preferred_role: string | null;
  role_fallback: "any" | "wait";
  requires_human_approval: number;
  approval_type: "none" | "before_step" | "after_step";
  risky: number;
  timeout_minutes: number;
  created_at: number;
  updated_at: number;
};

export type WorkflowRunRow = {
  id: string;
  workflow_id: string;
  status: WorkflowRunStatus;
  current_step_id: string | null;
  started_by_user_id: string | null;
  input_payload: string | null;
  started_at: number | null;
  completed_at: number | null;
  created_at: number;
  updated_at: number;
};

export type WorkflowStepRunRow = {
  id: string;
  workflow_run_id: string;
  step_id: string;
  step_order: number;
  job_id: string | null;
  run_id: string | null;
  status: StepRunStatus;
  approval_user_id: string | null;
  approval_at: number | null;
  approval_comment: string | null;
  created_at: number;
  updated_at: number;
};

export type WorkflowActivityRow = {
  id: string;
  workflow_run_id: string;
  step_run_id: string | null;
  author_type: string;
  author_id: string | null;
  author_name: string | null;
  kind: "comment" | "approve" | "reject" | "request_changes" | "status" | "start" | "finish";
  content: string | null;
  created_at: number;
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_STATUS: WorkflowStatus[] = ["draft", "active", "paused", "archived"];
const VALID_AUTONOMY: AutonomyLevel[] = ["manual", "supervised", "autonomous"];

function assertStatus(status: string): WorkflowStatus {
  if (!VALID_STATUS.includes(status as WorkflowStatus)) {
    throw new Error(`invalid workflow status: ${status}`);
  }
  return status as WorkflowStatus;
}
function assertAutonomy(level: string): AutonomyLevel {
  if (!VALID_AUTONOMY.includes(level as AutonomyLevel)) {
    throw new Error(`invalid autonomy_level: ${level}`);
  }
  return level as AutonomyLevel;
}

// ---------------------------------------------------------------------------
// CRUD: workflows (sync)
// ---------------------------------------------------------------------------

export function createWorkflow(input: {
  name: string;
  description?: string | null;
  department?: string | null;
  status?: WorkflowStatus;
  autonomyLevel?: AutonomyLevel;
}) {
  const db = getDb();
  const id = uuid();
  const status = input.status ? assertStatus(input.status) : "draft";
  const autonomy = input.autonomyLevel ? assertAutonomy(input.autonomyLevel) : "supervised";
  db.prepare(
    `INSERT INTO workflows (id, name, description, department, status, autonomy_level) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, input.name, input.description ?? null, input.department ?? null, status, autonomy);
  return getWorkflowById(id)!;
}

export function getWorkflowById(id: string): WorkflowRow | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM workflows WHERE id = ?`).get(id) as WorkflowRow | undefined;
  return row || null;
}

export function listWorkflows(): WorkflowRow[] {
  const db = getDb();
  return db.prepare(`SELECT * FROM workflows ORDER BY name`).all() as WorkflowRow[];
}

export function updateWorkflow(id: string, data: {
  name?: string;
  description?: string | null;
  department?: string | null;
  status?: WorkflowStatus;
  autonomyLevel?: AutonomyLevel;
}) {
  const db = getDb();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  if (data.name !== undefined) { fields.push("name = ?"); values.push(data.name); }
  if (data.description !== undefined) { fields.push("description = ?"); values.push(data.description); }
  if (data.department !== undefined) { fields.push("department = ?"); values.push(data.department); }
  if (data.status !== undefined) { fields.push("status = ?"); values.push(assertStatus(data.status)); }
  if (data.autonomyLevel !== undefined) { fields.push("autonomy_level = ?"); values.push(assertAutonomy(data.autonomyLevel)); }
  if (fields.length === 0) return getWorkflowById(id);
  fields.push("updated_at = unixepoch()");
  values.push(id);
  db.prepare(`UPDATE workflows SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getWorkflowById(id);
}

export function deleteWorkflow(id: string) {
  const db = getDb();
  db.prepare(`DELETE FROM workflows WHERE id = ?`).run(id);
}

// Steps
export function listWorkflowSteps(workflowId: string): WorkflowStepRow[] {
  const db = getDb();
  return db.prepare(`SELECT * FROM workflow_steps WHERE workflow_id = ? ORDER BY step_order ASC`)
    .all(workflowId) as WorkflowStepRow[];
}

export function createWorkflowStep(workflowId: string, input: {
  name: string;
  description?: string | null;
  instructions: string;
  assignedAgentId?: string | null;
  assignedTeamId?: string | null;
  preferredRole?: string | null;
  roleFallback?: "any" | "wait";
  requiresHumanApproval?: boolean;
  approvalType?: "none" | "before_step" | "after_step";
  risky?: boolean;
  timeoutMinutes?: number;
}) {
  if (!input.assignedAgentId && !input.assignedTeamId) {
    throw new Error("step must have an assigned agent or team");
  }
  const db = getDb();
  // Sparse ordering: place new step at max+10 so reorder doesn't have to renumber.
  const last = db.prepare(`SELECT MAX(step_order) AS m FROM workflow_steps WHERE workflow_id = ?`)
    .get(workflowId) as { m: number | null };
  const nextOrder = (last?.m ?? 0) + 10;
  const id = uuid();
  db.prepare(`INSERT INTO workflow_steps (
    id, workflow_id, step_order, name, description, instructions,
    assigned_agent_id, assigned_team_id, preferred_role, role_fallback,
    requires_human_approval, approval_type, risky, timeout_minutes
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, workflowId, nextOrder, input.name, input.description ?? null, input.instructions,
    input.assignedAgentId ?? null, input.assignedTeamId ?? null,
    input.preferredRole ?? null, input.roleFallback ?? "any",
    input.requiresHumanApproval ? 1 : 0,
    input.approvalType ?? "none",
    input.risky ? 1 : 0,
    input.timeoutMinutes ?? 30,
  );
  return db.prepare(`SELECT * FROM workflow_steps WHERE id = ?`).get(id) as WorkflowStepRow;
}

export function updateWorkflowStep(stepId: string, data: Partial<{
  name: string;
  description: string | null;
  instructions: string;
  assignedAgentId: string | null;
  assignedTeamId: string | null;
  preferredRole: string | null;
  roleFallback: "any" | "wait";
  requiresHumanApproval: boolean;
  approvalType: "none" | "before_step" | "after_step";
  risky: boolean;
  timeoutMinutes: number;
}>) {
  const db = getDb();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  const map: Record<string, [string, (v: unknown) => string | number | null]> = {
    name: ["name", v => v as string],
    description: ["description", v => v as string | null],
    instructions: ["instructions", v => v as string],
    assignedAgentId: ["assigned_agent_id", v => v as string | null],
    assignedTeamId: ["assigned_team_id", v => v as string | null],
    preferredRole: ["preferred_role", v => v as string | null],
    roleFallback: ["role_fallback", v => v as string],
    requiresHumanApproval: ["requires_human_approval", v => v ? 1 : 0],
    approvalType: ["approval_type", v => v as string],
    risky: ["risky", v => v ? 1 : 0],
    timeoutMinutes: ["timeout_minutes", v => Number(v)],
  };
  for (const [k, v] of Object.entries(data)) {
    const m = map[k]; if (!m) continue;
    fields.push(`${m[0]} = ?`);
    values.push(m[1](v));
  }
  if (fields.length === 0) return db.prepare(`SELECT * FROM workflow_steps WHERE id = ?`).get(stepId) as WorkflowStepRow;
  // Pre-validate: simulate the merged row to reject any update that strips
  // both routing targets. We can't rely on a CHECK constraint because the
  // existing column is nullable; the rule is enforced at the API boundary.
  const before = db.prepare(`SELECT assigned_agent_id, assigned_team_id FROM workflow_steps WHERE id = ?`).get(stepId) as { assigned_agent_id: string | null; assigned_team_id: string | null } | undefined;
  if (before) {
    const merged = {
      agent: "assignedAgentId" in data ? data.assignedAgentId ?? null : before.assigned_agent_id,
      team:  "assignedTeamId"  in data ? data.assignedTeamId  ?? null : before.assigned_team_id,
    };
    if (!merged.agent && !merged.team) throw new Error("step must have an assigned agent or team");
  }
  fields.push("updated_at = unixepoch()");
  values.push(stepId);
  db.prepare(`UPDATE workflow_steps SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return db.prepare(`SELECT * FROM workflow_steps WHERE id = ?`).get(stepId) as WorkflowStepRow;
}

export function deleteWorkflowStep(stepId: string) {
  const db = getDb();
  db.prepare(`DELETE FROM workflow_steps WHERE id = ?`).run(stepId);
}

/** Set the step_order field for each step in one transaction. Validates
 *  that every id belongs to this workflow first — otherwise the WHERE-clauses
 *  would silently skip foreign rows, masking client bugs and (worse) leaving
 *  the supplied order partially applied. */
export function reorderWorkflowSteps(workflowId: string, orderedStepIds: string[]) {
  const db = getDb();
  if (orderedStepIds.length === 0) return listWorkflowSteps(workflowId);
  const placeholders = orderedStepIds.map(() => "?").join(",");
  const found = db.prepare(
    `SELECT id FROM workflow_steps WHERE workflow_id = ? AND id IN (${placeholders})`,
  ).all(workflowId, ...orderedStepIds) as { id: string }[];
  if (found.length !== orderedStepIds.length) {
    throw new Error("reorder: one or more step IDs do not belong to this workflow");
  }
  const tx = db.transaction((ids: string[]) => {
    let order = 10;
    for (const id of ids) {
      db.prepare(`UPDATE workflow_steps SET step_order = ?, updated_at = unixepoch() WHERE id = ? AND workflow_id = ?`)
        .run(order, id, workflowId);
      order += 10;
    }
  });
  tx(orderedStepIds);
  return listWorkflowSteps(workflowId);
}

// ---------------------------------------------------------------------------
// Async variants
// ---------------------------------------------------------------------------

export async function createWorkflowAsync(input: {
  name: string;
  description?: string | null;
  department?: string | null;
  status?: WorkflowStatus;
  autonomyLevel?: AutonomyLevel;
}) {
  const db = await getDbAsync();
  const id = uuid();
  const status = input.status ? assertStatus(input.status) : "draft";
  const autonomy = input.autonomyLevel ? assertAutonomy(input.autonomyLevel) : "supervised";
  await db.run(
    `INSERT INTO workflows (id, name, description, department, status, autonomy_level) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, input.name, input.description ?? null, input.department ?? null, status, autonomy],
  );
  return (await getWorkflowByIdAsync(id))!;
}

export async function getWorkflowByIdAsync(id: string): Promise<WorkflowRow | null> {
  const db = await getDbAsync();
  return db.get<WorkflowRow>(`SELECT * FROM workflows WHERE id = ?`, [id]);
}

export async function listWorkflowsAsync(): Promise<WorkflowRow[]> {
  const db = await getDbAsync();
  return db.all<WorkflowRow>(`SELECT * FROM workflows ORDER BY name`);
}

export async function updateWorkflowAsync(id: string, data: {
  name?: string;
  description?: string | null;
  department?: string | null;
  status?: WorkflowStatus;
  autonomyLevel?: AutonomyLevel;
}) {
  const db = await getDbAsync();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  if (data.name !== undefined) { fields.push("name = ?"); values.push(data.name); }
  if (data.description !== undefined) { fields.push("description = ?"); values.push(data.description); }
  if (data.department !== undefined) { fields.push("department = ?"); values.push(data.department); }
  if (data.status !== undefined) { fields.push("status = ?"); values.push(assertStatus(data.status)); }
  if (data.autonomyLevel !== undefined) { fields.push("autonomy_level = ?"); values.push(assertAutonomy(data.autonomyLevel)); }
  if (fields.length === 0) return getWorkflowByIdAsync(id);
  fields.push(`updated_at = ${nowSql(db)}`);
  values.push(id);
  await db.run(`UPDATE workflows SET ${fields.join(", ")} WHERE id = ?`, values);
  return getWorkflowByIdAsync(id);
}

export async function deleteWorkflowAsync(id: string) {
  const db = await getDbAsync();
  await db.run(`DELETE FROM workflows WHERE id = ?`, [id]);
}

export async function listWorkflowStepsAsync(workflowId: string): Promise<WorkflowStepRow[]> {
  const db = await getDbAsync();
  return db.all<WorkflowStepRow>(
    `SELECT * FROM workflow_steps WHERE workflow_id = ? ORDER BY step_order ASC`, [workflowId],
  );
}

export async function createWorkflowStepAsync(workflowId: string, input: Parameters<typeof createWorkflowStep>[1]) {
  if (!input.assignedAgentId && !input.assignedTeamId) {
    throw new Error("step must have an assigned agent or team");
  }
  const db = await getDbAsync();
  const last = await db.get<{ m: number | null }>(
    `SELECT MAX(step_order) AS m FROM workflow_steps WHERE workflow_id = ?`, [workflowId],
  );
  const nextOrder = (last?.m ?? 0) + 10;
  const id = uuid();
  await db.run(`INSERT INTO workflow_steps (
    id, workflow_id, step_order, name, description, instructions,
    assigned_agent_id, assigned_team_id, preferred_role, role_fallback,
    requires_human_approval, approval_type, risky, timeout_minutes
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    id, workflowId, nextOrder, input.name, input.description ?? null, input.instructions,
    input.assignedAgentId ?? null, input.assignedTeamId ?? null,
    input.preferredRole ?? null, input.roleFallback ?? "any",
    input.requiresHumanApproval ? 1 : 0,
    input.approvalType ?? "none",
    input.risky ? 1 : 0,
    input.timeoutMinutes ?? 30,
  ]);
  return db.get<WorkflowStepRow>(`SELECT * FROM workflow_steps WHERE id = ?`, [id]);
}

export async function updateWorkflowStepAsync(stepId: string, data: Parameters<typeof updateWorkflowStep>[1]) {
  const db = await getDbAsync();
  const fields: string[] = [];
  const values: (string | number | null)[] = [];
  const map: Record<string, [string, (v: unknown) => string | number | null]> = {
    name: ["name", v => v as string],
    description: ["description", v => v as string | null],
    instructions: ["instructions", v => v as string],
    assignedAgentId: ["assigned_agent_id", v => v as string | null],
    assignedTeamId: ["assigned_team_id", v => v as string | null],
    preferredRole: ["preferred_role", v => v as string | null],
    roleFallback: ["role_fallback", v => v as string],
    requiresHumanApproval: ["requires_human_approval", v => v ? 1 : 0],
    approvalType: ["approval_type", v => v as string],
    risky: ["risky", v => v ? 1 : 0],
    timeoutMinutes: ["timeout_minutes", v => Number(v)],
  };
  for (const [k, v] of Object.entries(data)) {
    const m = map[k]; if (!m) continue;
    fields.push(`${m[0]} = ?`);
    values.push(m[1](v));
  }
  if (fields.length === 0) return db.get<WorkflowStepRow>(`SELECT * FROM workflow_steps WHERE id = ?`, [stepId]);
  const before = await db.get<{ assigned_agent_id: string | null; assigned_team_id: string | null }>(
    `SELECT assigned_agent_id, assigned_team_id FROM workflow_steps WHERE id = ?`, [stepId],
  );
  if (before) {
    const merged = {
      agent: "assignedAgentId" in data ? data.assignedAgentId ?? null : before.assigned_agent_id,
      team:  "assignedTeamId"  in data ? data.assignedTeamId  ?? null : before.assigned_team_id,
    };
    if (!merged.agent && !merged.team) throw new Error("step must have an assigned agent or team");
  }
  fields.push(`updated_at = ${nowSql(db)}`);
  values.push(stepId);
  await db.run(`UPDATE workflow_steps SET ${fields.join(", ")} WHERE id = ?`, values);
  return db.get<WorkflowStepRow>(`SELECT * FROM workflow_steps WHERE id = ?`, [stepId]);
}

export async function deleteWorkflowStepAsync(stepId: string) {
  const db = await getDbAsync();
  await db.run(`DELETE FROM workflow_steps WHERE id = ?`, [stepId]);
}

export async function reorderWorkflowStepsAsync(workflowId: string, orderedStepIds: string[]) {
  const db = await getDbAsync();
  if (orderedStepIds.length === 0) return listWorkflowStepsAsync(workflowId);
  // Validate up-front: every id must belong to this workflow. Otherwise the
  // per-row WHERE workflow_id check silently skips foreign rows and we'd
  // partially apply the order without reporting an error.
  const placeholders = orderedStepIds.map(() => "?").join(",");
  const found = await db.all<{ id: string }>(
    `SELECT id FROM workflow_steps WHERE workflow_id = ? AND id IN (${placeholders})`,
    [workflowId, ...orderedStepIds],
  );
  if (found.length !== orderedStepIds.length) {
    throw new Error("reorder: one or more step IDs do not belong to this workflow");
  }
  await db.transaction(async (tx) => {
    let order = 10;
    for (const id of orderedStepIds) {
      await tx.run(
        `UPDATE workflow_steps SET step_order = ?, updated_at = ${nowSql(tx)} WHERE id = ? AND workflow_id = ?`,
        [order, id, workflowId],
      );
      order += 10;
    }
  });
  return listWorkflowStepsAsync(workflowId);
}

// ---------------------------------------------------------------------------
// Execution: start, advance, approve, reject, request changes
// ---------------------------------------------------------------------------

/** Build the instructions sent to the agent for a step run. Substitutes
 *  `{{input.key}}` from the workflow_run.input_payload JSON. */
function renderInstructions(template: string, inputPayload: string | null): string {
  let payload: Record<string, unknown> = {};
  if (inputPayload) {
    try { payload = JSON.parse(inputPayload) || {}; } catch { /* ignore */ }
  }
  return template.replace(/\{\{\s*input\.([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const v = payload[key];
    return v == null ? "" : String(v);
  });
}

/**
 * Spawn the job + run for a step run that is ready to execute. Returns
 * the run_id created. The caller is responsible for updating the
 * step_run's status from waiting_approval_before → running.
 */
async function spawnStepJobAndRun(stepRun: WorkflowStepRunRow, step: WorkflowStepRow, workflowRun: WorkflowRunRow, workflow: WorkflowRow): Promise<{ jobId: string; runId: string }> {
  // Defense in depth: a step with no agent and no team produces a job that
  // getAgentNextRun will never claim — the workflow would hang silently.
  // createWorkflowStepAsync also rejects this case, but enforce it here too
  // in case the row was created before the validation existed.
  if (!step.assigned_agent_id && !step.assigned_team_id) {
    throw new Error(`step "${step.name}" has neither an assigned agent nor a team — cannot spawn run`);
  }
  const db = await getDbAsync();
  const jobId = uuid();
  const runId = uuid();
  const now = Math.floor(Date.now() / 1000);
  const instructions = renderInstructions(step.instructions, workflowRun.input_payload);
  // Use either agent_id OR team_id+preferred_role+role_fallback. The
  // existing getAgentNextRun priority ladder claims based on whichever
  // is set.
  await db.transaction(async (tx) => {
    await tx.run(`
      INSERT INTO jobs (id, agent_id, team_id, preferred_role, role_fallback, name, instructions, schedule, one_off, active, next_run_at, timeout_minutes)
      VALUES (?, ?, ?, ?, ?, ?, ?, '{}', 1, 1, ?, ?)
    `, [
      jobId,
      step.assigned_agent_id, step.assigned_team_id, step.preferred_role, step.role_fallback,
      `${workflow.name} — ${step.name}`,
      instructions,
      now, step.timeout_minutes,
    ]);
    await tx.run(`
      INSERT INTO runs (id, job_id, agent_id, status, scheduled_for, created_at, updated_at)
      VALUES (?, ?, ?, 'scheduled', ?, ?, ?)
    `, [runId, jobId, step.assigned_agent_id, now, now, now]);
    await tx.run(
      `UPDATE workflow_step_runs SET job_id = ?, run_id = ?, status = 'running', updated_at = ${nowSql(tx)} WHERE id = ?`,
      [jobId, runId, stepRun.id],
    );
  });
  return { jobId, runId };
}

/**
 * Choose an action_type for a step's autonomy-policy lookup. Steps are
 * generic prompts so we use a coarse pair: `update_status` for routine work,
 * and `modify_production` when the user has flagged the step as risky. This
 * is the policy-layer counterpart to the workflow_helpers gate (which decides
 * approval purely from autonomy_level + per-step flags).
 */
function actionTypeForStep(step: WorkflowStepRow): ActionType {
  return step.risky ? "modify_production" : "update_status";
}

/**
 * Returns a policy decision for the given step. The workflow gate logic
 * (`requiresBeforeApproval` / `requiresAfterApproval`) and the policy layer
 * compose: if either says "approval required", the step pauses.
 */
async function evaluateStepPolicy(step: WorkflowStepRow, workflow: WorkflowRow): Promise<Decision> {
  return evaluatePolicy({
    agentId: step.assigned_agent_id ?? null,
    teamId: step.assigned_team_id ?? null,
    workflowId: workflow.id,
    department: workflow.department ?? null,
    actionType: actionTypeForStep(step),
  });
}

async function logActivity(workflowRunId: string, stepRunId: string | null, authorType: string, authorId: string | null, authorName: string | null, kind: WorkflowActivityRow["kind"], content: string | null) {
  const db = await getDbAsync();
  await db.run(
    `INSERT INTO workflow_run_activity (id, workflow_run_id, step_run_id, author_type, author_id, author_name, kind, content) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [uuid(), workflowRunId, stepRunId, authorType, authorId, authorName, kind, content],
  );
}

/** Start a workflow run. The caller passes the workflow id, the user
 *  who started it, and an optional inputPayload (JSON-serializable
 *  object). Returns the new workflow_run + first step_run row. */
export async function startWorkflowRunAsync(workflowId: string, opts: {
  userId?: string | null;
  userName?: string | null;
  inputPayload?: Record<string, unknown> | null;
} = {}): Promise<{ workflowRunId: string; firstStepRunId: string }> {
  const workflow = await getWorkflowByIdAsync(workflowId);
  if (!workflow) throw new Error("workflow not found");
  const steps = await listWorkflowStepsAsync(workflowId);
  if (steps.length === 0) throw new Error("workflow has no steps");
  const firstStep = steps[0];

  const workflowRunId = uuid();
  const firstStepRunId = uuid();
  const now = Math.floor(Date.now() / 1000);
  const inputJson = opts.inputPayload ? JSON.stringify(opts.inputPayload) : null;

  const db = await getDbAsync();
  await db.transaction(async (tx) => {
    await tx.run(`
      INSERT INTO workflow_runs (id, workflow_id, status, current_step_id, started_by_user_id, input_payload, started_at)
      VALUES (?, ?, 'running', ?, ?, ?, ?)
    `, [workflowRunId, workflowId, firstStep.id, opts.userId ?? null, inputJson, now]);
    await tx.run(`
      INSERT INTO workflow_step_runs (id, workflow_run_id, step_id, step_order, status)
      VALUES (?, ?, ?, ?, 'pending')
    `, [firstStepRunId, workflowRunId, firstStep.id, firstStep.step_order]);
  });

  await logActivity(workflowRunId, firstStepRunId, opts.userId ? "user" : "system", opts.userId ?? null, opts.userName ?? null, "start", `Started workflow "${workflow.name}"`);

  // Decide on before-step approval gate. Workflow-level gate (autonomy_level
  // + risky/requires flags) OR autonomy-policy gate; either pauses the step.
  const stepGate = requiresBeforeApproval(firstStep, workflow);
  const policyGate = await evaluateStepPolicy(firstStep, workflow);
  if (stepGate || !policyGate.allow) {
    await db.run(
      `UPDATE workflow_step_runs SET status = 'waiting_approval_before', updated_at = ${nowSql(db)} WHERE id = ?`,
      [firstStepRunId],
    );
    await db.run(
      `UPDATE workflow_runs SET status = 'waiting_for_approval', updated_at = ${nowSql(db)} WHERE id = ?`,
      [workflowRunId],
    );
    const reason = !policyGate.allow ? policyGate.reason : `Awaiting approval before step "${firstStep.name}"`;
    await logActivity(workflowRunId, firstStepRunId, "system", null, null, "status", reason);
    if (!policyGate.allow) {
      await createApprovalRequestAsync({
        sourceType: "workflow_step",
        sourceId: firstStepRunId,
        actionType: policyGate.rule.action_type,
        riskLevel: policyGate.rule.risk_level,
        reason: policyGate.reason,
        payloadJson: JSON.stringify({ workflowRunId, stepId: firstStep.id, stepName: firstStep.name }),
      });
    }
  } else {
    // Spawn the run now.
    const stepRun = (await db.get<WorkflowStepRunRow>(`SELECT * FROM workflow_step_runs WHERE id = ?`, [firstStepRunId]))!;
    await spawnStepJobAndRun(stepRun, firstStep, (await db.get<WorkflowRunRow>(`SELECT * FROM workflow_runs WHERE id = ?`, [workflowRunId]))!, workflow);
  }

  return { workflowRunId, firstStepRunId };
}

/** Called from updateRunStatusAsync when a run reaches a terminal status.
 *  Looks up any matching workflow_step_run; if found, advances the workflow
 *  (gating on after-step approval as appropriate). */
export async function advanceWorkflowAfterRunAsync(runId: string, terminalStatus: string): Promise<void> {
  const db = await getDbAsync();
  const stepRun = await db.get<WorkflowStepRunRow>(
    `SELECT * FROM workflow_step_runs WHERE run_id = ? AND status = 'running'`, [runId],
  );
  if (!stepRun) {
    // The run could belong to a step that's already been advanced (e.g. the
    // hook fired twice on a status that re-transitions). Surface this to the
    // activity log instead of silently swallowing — masking state mismatches
    // here was the cause of two pre-stabilization bug reports.
    const orphan = await db.get<{ workflow_run_id: string; status: string }>(
      `SELECT workflow_run_id, status FROM workflow_step_runs WHERE run_id = ? LIMIT 1`,
      [runId],
    );
    if (orphan) {
      await logActivity(
        orphan.workflow_run_id, null, "system", null, null, "status",
        `advancement skipped: run reached ${terminalStatus} but step_run is already in state ${orphan.status}`,
      );
    }
    return;
  }

  const workflowRun = await db.get<WorkflowRunRow>(
    `SELECT * FROM workflow_runs WHERE id = ?`, [stepRun.workflow_run_id],
  );
  if (!workflowRun) return;
  const workflow = await getWorkflowByIdAsync(workflowRun.workflow_id);
  if (!workflow) return;
  const step = await db.get<WorkflowStepRow>(`SELECT * FROM workflow_steps WHERE id = ?`, [stepRun.step_id]);
  if (!step) return;

  // Failure / kill / skip → step + workflow fail.
  if (terminalStatus === "failed" || terminalStatus === "killed" || terminalStatus === "skipped") {
    const newStepStatus: StepRunStatus = terminalStatus === "skipped" ? "skipped" : "failed";
    await db.run(`UPDATE workflow_step_runs SET status = ?, updated_at = ${nowSql(db)} WHERE id = ?`,
      [newStepStatus, stepRun.id]);
    await db.run(
      `UPDATE workflow_runs SET status = 'failed', completed_at = ?, updated_at = ${nowSql(db)} WHERE id = ?`,
      [Math.floor(Date.now() / 1000), workflowRun.id],
    );
    await logActivity(workflowRun.id, stepRun.id, "system", null, null, "status", `Step "${step.name}" ${newStepStatus}; workflow failed`);
    return;
  }

  // done → after-step approval or advance.
  if (terminalStatus === "done") {
    const stepGate = requiresAfterApproval(step, workflow);
    const policyGate = await evaluateStepPolicy(step, workflow);
    if (stepGate || !policyGate.allow) {
      await db.run(`UPDATE workflow_step_runs SET status = 'waiting_approval_after', updated_at = ${nowSql(db)} WHERE id = ?`, [stepRun.id]);
      await db.run(`UPDATE workflow_runs SET status = 'waiting_for_approval', updated_at = ${nowSql(db)} WHERE id = ?`, [workflowRun.id]);
      const reason = !policyGate.allow ? policyGate.reason : `Step "${step.name}" awaiting approval`;
      await logActivity(workflowRun.id, stepRun.id, "system", null, null, "status", reason);
      if (!policyGate.allow) {
        await createApprovalRequestAsync({
          sourceType: "workflow_step",
          sourceId: stepRun.id,
          actionType: policyGate.rule.action_type,
          riskLevel: policyGate.rule.risk_level,
          reason: policyGate.reason,
          payloadJson: JSON.stringify({ workflowRunId: workflowRun.id, stepId: step.id, stepName: step.name }),
        });
      }
      return;
    }
    await advanceToNextStep(workflowRun.id, step, stepRun.id);
  }
}

/** Mark current step done, find next step, spawn it (gated on before-approval). */
async function advanceToNextStep(workflowRunId: string, completedStep: WorkflowStepRow, completedStepRunId: string) {
  const db = await getDbAsync();
  await db.run(`UPDATE workflow_step_runs SET status = 'done', updated_at = ${nowSql(db)} WHERE id = ?`,
    [completedStepRunId]);

  const workflowRun = (await db.get<WorkflowRunRow>(`SELECT * FROM workflow_runs WHERE id = ?`, [workflowRunId]))!;
  const workflow = (await getWorkflowByIdAsync(workflowRun.workflow_id))!;

  const next = await db.get<WorkflowStepRow>(
    `SELECT * FROM workflow_steps WHERE workflow_id = ? AND step_order > ? ORDER BY step_order ASC LIMIT 1`,
    [workflowRun.workflow_id, completedStep.step_order],
  );

  if (!next) {
    // Workflow complete.
    await db.run(
      `UPDATE workflow_runs SET status = 'done', current_step_id = NULL, completed_at = ?, updated_at = ${nowSql(db)} WHERE id = ?`,
      [Math.floor(Date.now() / 1000), workflowRunId],
    );
    await logActivity(workflowRunId, null, "system", null, null, "finish", `Workflow "${workflow.name}" complete`);
    return;
  }

  // Create the next step_run; gate on before-approval.
  const stepRunId = uuid();
  await db.run(`INSERT INTO workflow_step_runs (id, workflow_run_id, step_id, step_order, status) VALUES (?, ?, ?, ?, 'pending')`,
    [stepRunId, workflowRunId, next.id, next.step_order]);
  await db.run(`UPDATE workflow_runs SET current_step_id = ?, updated_at = ${nowSql(db)} WHERE id = ?`, [next.id, workflowRunId]);

  const stepGate = requiresBeforeApproval(next, workflow);
  const policyGate = await evaluateStepPolicy(next, workflow);
  if (stepGate || !policyGate.allow) {
    await db.run(`UPDATE workflow_step_runs SET status = 'waiting_approval_before', updated_at = ${nowSql(db)} WHERE id = ?`, [stepRunId]);
    await db.run(`UPDATE workflow_runs SET status = 'waiting_for_approval', updated_at = ${nowSql(db)} WHERE id = ?`, [workflowRunId]);
    const reason = !policyGate.allow ? policyGate.reason : `Awaiting approval before step "${next.name}"`;
    await logActivity(workflowRunId, stepRunId, "system", null, null, "status", reason);
    if (!policyGate.allow) {
      await createApprovalRequestAsync({
        sourceType: "workflow_step",
        sourceId: stepRunId,
        actionType: policyGate.rule.action_type,
        riskLevel: policyGate.rule.risk_level,
        reason: policyGate.reason,
        payloadJson: JSON.stringify({ workflowRunId, stepId: next.id, stepName: next.name }),
      });
    }
    return;
  }
  // Spawn the run now.
  const stepRun = (await db.get<WorkflowStepRunRow>(`SELECT * FROM workflow_step_runs WHERE id = ?`, [stepRunId]))!;
  await spawnStepJobAndRun(stepRun, next, workflowRun, workflow);
}

// ---------------------------------------------------------------------------
// Approval flow
// ---------------------------------------------------------------------------

/** Thrown when an approval/reject/resume races another concurrent operator
 *  click. Routes translate this to HTTP 409 so the UI can refresh cleanly. */
export class WorkflowConflictError extends Error {
  readonly code = "WORKFLOW_CONFLICT";
  constructor(message: string) { super(message); this.name = "WorkflowConflictError"; }
}

export async function approveCurrentStepAsync(workflowRunId: string, opts: { userId?: string | null; userName?: string | null; comment?: string | null }) {
  const db = await getDbAsync();

  // CAS: flip the workflow_run out of waiting_for_approval atomically. If two
  // operators click Approve at the same time, exactly one of them wins; the
  // loser sees changes === 0 and we throw WorkflowConflictError (→ 409 at
  // the route layer). Without this guard both calls fell through and
  // spawned duplicate jobs.
  const cas = await db.run(
    `UPDATE workflow_runs SET status = 'running', updated_at = ${nowSql(db)} WHERE id = ? AND status = 'waiting_for_approval'`,
    [workflowRunId],
  );
  if (!cas || cas.changes === 0) {
    const wr = await db.get<WorkflowRunRow>(`SELECT status FROM workflow_runs WHERE id = ?`, [workflowRunId]);
    if (!wr) throw new Error("workflow run not found");
    throw new WorkflowConflictError(`workflow run is not waiting for approval (status: ${wr.status})`);
  }

  const workflowRun = (await db.get<WorkflowRunRow>(`SELECT * FROM workflow_runs WHERE id = ?`, [workflowRunId]))!;

  // Find the step_run that's waiting.
  const stepRun = await db.get<WorkflowStepRunRow>(
    `SELECT * FROM workflow_step_runs WHERE workflow_run_id = ? AND status IN ('waiting_approval_before','waiting_approval_after') ORDER BY step_order DESC LIMIT 1`,
    [workflowRunId],
  );
  if (!stepRun) throw new Error("no step is waiting for approval");
  const step = (await db.get<WorkflowStepRow>(`SELECT * FROM workflow_steps WHERE id = ?`, [stepRun.step_id]))!;
  const workflow = (await getWorkflowByIdAsync(workflowRun.workflow_id))!;

  const now = Math.floor(Date.now() / 1000);
  await db.run(
    `UPDATE workflow_step_runs SET approval_user_id = ?, approval_at = ?, approval_comment = ?, updated_at = ${nowSql(db)} WHERE id = ?`,
    [opts.userId ?? null, now, opts.comment ?? null, stepRun.id],
  );
  if (opts.userId) {
    await resolveStepApprovalsAsync(stepRun.id, "approved", opts.userId, opts.comment ?? null);
  }
  await logActivity(workflowRunId, stepRun.id, "user", opts.userId ?? null, opts.userName ?? null, "approve", opts.comment ?? null);

  if (stepRun.status === "waiting_approval_before") {
    // Resume by spawning the run.
    const refreshed = (await db.get<WorkflowStepRunRow>(`SELECT * FROM workflow_step_runs WHERE id = ?`, [stepRun.id]))!;
    await spawnStepJobAndRun(refreshed, step, workflowRun, workflow);
  } else {
    // after_step approval → step is done, advance.
    await advanceToNextStep(workflowRunId, step, stepRun.id);
  }
}

export async function rejectWorkflowRunAsync(workflowRunId: string, opts: { userId?: string | null; userName?: string | null; comment?: string | null }) {
  const db = await getDbAsync();

  // CAS: flip workflow_run waiting_for_approval → rejected atomically.
  // Concurrent click → second loses → 409 at the route layer.
  const now = Math.floor(Date.now() / 1000);
  const cas = await db.run(
    `UPDATE workflow_runs SET status = 'rejected', current_step_id = NULL, completed_at = ?, updated_at = ${nowSql(db)} WHERE id = ? AND status = 'waiting_for_approval'`,
    [now, workflowRunId],
  );
  if (!cas || cas.changes === 0) {
    const wr = await db.get<WorkflowRunRow>(`SELECT status FROM workflow_runs WHERE id = ?`, [workflowRunId]);
    if (!wr) throw new Error("workflow run not found");
    throw new WorkflowConflictError(`workflow run is not waiting for approval (status: ${wr.status})`);
  }

  const stepRun = await db.get<WorkflowStepRunRow>(
    `SELECT * FROM workflow_step_runs WHERE workflow_run_id = ? AND status IN ('waiting_approval_before','waiting_approval_after') ORDER BY step_order DESC LIMIT 1`,
    [workflowRunId],
  );
  if (stepRun) {
    await db.run(
      `UPDATE workflow_step_runs SET status = 'rejected', approval_user_id = ?, approval_at = ?, approval_comment = ?, updated_at = ${nowSql(db)} WHERE id = ?`,
      [opts.userId ?? null, now, opts.comment ?? null, stepRun.id],
    );
    if (opts.userId) {
      await resolveStepApprovalsAsync(stepRun.id, "rejected", opts.userId, opts.comment ?? null);
    }
  }
  await logActivity(workflowRunId, stepRun?.id ?? null, "user", opts.userId ?? null, opts.userName ?? null, "reject", opts.comment ?? null);
}

export async function requestStepChangesAsync(workflowRunId: string, opts: { userId?: string | null; userName?: string | null; comment: string; extraInstructions?: string | null }) {
  const db = await getDbAsync();
  const workflowRun = await db.get<WorkflowRunRow>(`SELECT * FROM workflow_runs WHERE id = ?`, [workflowRunId]);
  if (!workflowRun) throw new Error("workflow run not found");
  if (workflowRun.status !== "waiting_for_approval") {
    throw new WorkflowConflictError(`workflow run is not waiting for approval (status: ${workflowRun.status})`);
  }

  const stepRun = (await db.get<WorkflowStepRunRow>(
    `SELECT * FROM workflow_step_runs WHERE workflow_run_id = ? AND status IN ('waiting_approval_before','waiting_approval_after') ORDER BY step_order DESC LIMIT 1`,
    [workflowRunId],
  ))!;
  const now = Math.floor(Date.now() / 1000);
  const combined = opts.extraInstructions
    ? `${opts.comment}\n\nAdditional instructions:\n${opts.extraInstructions}`
    : opts.comment;
  await db.run(
    `UPDATE workflow_step_runs SET status = 'needs_changes', approval_user_id = ?, approval_at = ?, approval_comment = ?, updated_at = ${nowSql(db)} WHERE id = ?`,
    [opts.userId ?? null, now, combined, stepRun.id],
  );
  // Keep workflow_run in waiting_for_approval until resume is called.
  await logActivity(workflowRunId, stepRun.id, "user", opts.userId ?? null, opts.userName ?? null, "request_changes", combined);
}

export async function resumeAfterChangesAsync(workflowRunId: string, opts: { userId?: string | null; userName?: string | null }) {
  const db = await getDbAsync();
  const workflowRun = await db.get<WorkflowRunRow>(`SELECT * FROM workflow_runs WHERE id = ?`, [workflowRunId]);
  if (!workflowRun) throw new Error("workflow run not found");
  const stepRun = await db.get<WorkflowStepRunRow>(
    `SELECT * FROM workflow_step_runs WHERE workflow_run_id = ? AND status = 'needs_changes' ORDER BY step_order DESC LIMIT 1`,
    [workflowRunId],
  );
  if (!stepRun) throw new Error("no step in needs_changes state");
  const step = (await db.get<WorkflowStepRow>(`SELECT * FROM workflow_steps WHERE id = ?`, [stepRun.step_id]))!;
  const workflow = (await getWorkflowByIdAsync(workflowRun.workflow_id))!;

  // Re-spawn the step with the approval_comment appended to instructions.
  // (For a before_step gate this is a fresh spawn; for after_step we
  // re-run the step.)
  const appended: WorkflowStepRow = {
    ...step,
    instructions: stepRun.approval_comment
      ? `${step.instructions}\n\n---\n\nReviewer feedback:\n${stepRun.approval_comment}`
      : step.instructions,
  };
  await db.run(`UPDATE workflow_runs SET status = 'running', updated_at = ${nowSql(db)} WHERE id = ?`, [workflowRunId]);
  await db.run(`UPDATE workflow_step_runs SET status = 'running', job_id = NULL, run_id = NULL, updated_at = ${nowSql(db)} WHERE id = ?`, [stepRun.id]);
  const refreshed = (await db.get<WorkflowStepRunRow>(`SELECT * FROM workflow_step_runs WHERE id = ?`, [stepRun.id]))!;
  await spawnStepJobAndRun(refreshed, appended, workflowRun, workflow);
  await logActivity(workflowRunId, stepRun.id, "user", opts.userId ?? null, opts.userName ?? null, "status", "Resumed with reviewer feedback");
}

export async function addWorkflowCommentAsync(workflowRunId: string, opts: { userId?: string | null; userName?: string | null; content: string }) {
  const wfRun = await getWorkflowRunByIdAsync(workflowRunId);
  if (!wfRun) throw new Error("workflow run not found");
  await logActivity(workflowRunId, null, opts.userId ? "user" : "system", opts.userId ?? null, opts.userName ?? null, "comment", opts.content);
}

// ---------------------------------------------------------------------------
// Read APIs
// ---------------------------------------------------------------------------

export async function getWorkflowRunByIdAsync(id: string): Promise<WorkflowRunRow | null> {
  const db = await getDbAsync();
  return db.get<WorkflowRunRow>(`SELECT * FROM workflow_runs WHERE id = ?`, [id]);
}

export async function listWorkflowRunsAsync(workflowId?: string): Promise<WorkflowRunRow[]> {
  const db = await getDbAsync();
  if (workflowId) {
    return db.all<WorkflowRunRow>(
      `SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY created_at DESC LIMIT 100`, [workflowId],
    );
  }
  return db.all<WorkflowRunRow>(`SELECT * FROM workflow_runs ORDER BY created_at DESC LIMIT 100`);
}

export async function listWorkflowStepRunsAsync(workflowRunId: string): Promise<WorkflowStepRunRow[]> {
  const db = await getDbAsync();
  return db.all<WorkflowStepRunRow>(
    `SELECT * FROM workflow_step_runs WHERE workflow_run_id = ? ORDER BY step_order ASC`, [workflowRunId],
  );
}

export async function listWorkflowRunActivityAsync(workflowRunId: string): Promise<WorkflowActivityRow[]> {
  const db = await getDbAsync();
  return db.all<WorkflowActivityRow>(
    `SELECT * FROM workflow_run_activity WHERE workflow_run_id = ? ORDER BY created_at ASC`, [workflowRunId],
  );
}
