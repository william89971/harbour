/**
 * Pure decision functions for workflow step gating. Separated so the
 * autonomy matrix is unit-testable without spinning up a DB.
 */

export type AutonomyLevel = "manual" | "supervised" | "autonomous";
export type ApprovalType = "none" | "before_step" | "after_step";

export type StepGate = {
  approval_type: ApprovalType;
  requires_human_approval: boolean | number; // 0/1 from SQLite
  risky: boolean | number;
};

export type WorkflowGate = {
  autonomy_level: AutonomyLevel;
};

function bool(v: boolean | number | null | undefined): boolean {
  return !!v;
}

/**
 * Should this step pause for approval BEFORE the agent runs?
 *
 * - autonomy=manual → always (every step pauses).
 * - autonomy=supervised → if risky OR requires_human_approval OR approval_type='before_step'.
 * - autonomy=autonomous → only if requires_human_approval explicitly true AND approval_type='before_step'.
 */
export function requiresBeforeApproval(step: StepGate, workflow: WorkflowGate): boolean {
  const autonomy = workflow.autonomy_level;
  const requires = bool(step.requires_human_approval);
  const risky = bool(step.risky);
  const isBefore = step.approval_type === "before_step";

  if (autonomy === "manual") return true;
  if (autonomy === "supervised") {
    return risky || requires || isBefore;
  }
  // autonomous
  return isBefore && requires;
}

/**
 * Should this step pause for approval AFTER the agent runs?
 *
 * - autonomy=manual → if approval_type='after_step' OR risky (manual always
 *   pauses BEFORE; after-step approval is only meaningful when not also a
 *   before-step gate). We treat manual as before-only.
 * - autonomy=supervised → if approval_type='after_step' AND (risky OR requires).
 * - autonomy=autonomous → only if requires_human_approval AND approval_type='after_step'.
 */
export function requiresAfterApproval(step: StepGate, workflow: WorkflowGate): boolean {
  const autonomy = workflow.autonomy_level;
  const requires = bool(step.requires_human_approval);
  const risky = bool(step.risky);
  const isAfter = step.approval_type === "after_step";

  if (!isAfter) return false;
  if (autonomy === "manual") return true;
  if (autonomy === "supervised") return risky || requires;
  return requires; // autonomous
}
