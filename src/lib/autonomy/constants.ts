/**
 * Autonomy / approval-policy constants. The action_type enum is the single
 * vocabulary used by policies, rules, approval_requests, and the tool-name
 * mapping in `tool-map.ts`. New action types must be added here first so the
 * TypeScript layer rejects typos at compile time.
 *
 * Risk levels are advisory — they don't drive decisions on their own. A rule
 * with `require_approval=1` blocks regardless of risk; a rule with
 * `max_cost_usd != null` blocks only when the cost is exceeded. Risk is the
 * label shown to operators and the bucket used by the default seed.
 */

export const ACTION_TYPES = [
  "send_email",
  "send_message",
  "contact_customer",
  "spend_money",
  "deploy_code",
  "merge_pr",
  "delete_data",
  "modify_production",
  "use_secret",
  "external_api_call",
  "create_handoff",
  "update_status",
  "custom",
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];

export function isActionType(value: string): value is ActionType {
  return (ACTION_TYPES as readonly string[]).includes(value);
}

export const RISK_LEVELS = ["low", "medium", "high", "critical"] as const;

export type RiskLevel = (typeof RISK_LEVELS)[number];

export function isRiskLevel(value: string): value is RiskLevel {
  return (RISK_LEVELS as readonly string[]).includes(value);
}

export const SCOPE_TYPES = ["global", "department", "workflow", "agent", "team"] as const;

export type ScopeType = (typeof SCOPE_TYPES)[number];

export const APPROVAL_SOURCE_TYPES = ["run", "workflow_run", "workflow_step", "tool_call", "cost"] as const;

export type ApprovalSourceType = (typeof APPROVAL_SOURCE_TYPES)[number];

export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "expired"] as const;

export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
