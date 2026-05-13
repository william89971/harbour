import { getDbAsync } from "../db/schema";
import type { ActionType, RiskLevel, ScopeType } from "./constants";
import type { AutonomyPolicyRow, PolicyRuleRow } from "../db/autonomy";

export type ResolveCtx = {
  agentId?: string | null;
  teamId?: string | null;
  workflowId?: string | null;
  department?: string | null;
  actionType: ActionType;
  riskLevel?: RiskLevel;
  costUsd?: number | null;
};

export type Decision =
  | { allow: true; rule: PolicyRuleRow | null; policy: AutonomyPolicyRow | null }
  | { allow: false; rule: PolicyRuleRow; policy: AutonomyPolicyRow; reason: string };

/**
 * Walk the scope ladder (agent > team > workflow > department > global) and
 * return the first matching policy that has a rule for the given action_type.
 * Within a matched policy:
 *   - require_approval=1 → blocked.
 *   - max_cost_usd != null && ctx.costUsd > max_cost_usd → blocked.
 *   - otherwise allowed.
 * If no policy anywhere has a rule for the action, fall through to allow —
 * unknown actions are permitted so upgrades don't silently break installs.
 */
export async function evaluatePolicy(ctx: ResolveCtx): Promise<Decision> {
  const ladder: Array<{ scope_type: ScopeType; scope_id: string | null }> = [];
  if (ctx.agentId) ladder.push({ scope_type: "agent", scope_id: ctx.agentId });
  if (ctx.teamId) ladder.push({ scope_type: "team", scope_id: ctx.teamId });
  if (ctx.workflowId) ladder.push({ scope_type: "workflow", scope_id: ctx.workflowId });
  if (ctx.department) ladder.push({ scope_type: "department", scope_id: ctx.department });
  ladder.push({ scope_type: "global", scope_id: null });

  const db = await getDbAsync();

  for (const level of ladder) {
    const policy = level.scope_id == null
      ? await db.get<AutonomyPolicyRow>(
          `SELECT * FROM autonomy_policies WHERE scope_type = ? AND scope_id IS NULL AND enabled = 1 ORDER BY created_at ASC LIMIT 1`,
          [level.scope_type],
        )
      : await db.get<AutonomyPolicyRow>(
          `SELECT * FROM autonomy_policies WHERE scope_type = ? AND scope_id = ? AND enabled = 1 ORDER BY created_at ASC LIMIT 1`,
          [level.scope_type, level.scope_id],
        );

    if (!policy) continue;

    const rule = await db.get<PolicyRuleRow>(
      `SELECT * FROM policy_rules WHERE policy_id = ? AND action_type = ?`,
      [policy.id, ctx.actionType],
    );
    if (!rule) continue;

    if (rule.require_approval === 1) {
      return {
        allow: false,
        rule,
        policy,
        reason: `Policy "${policy.name}" requires approval for ${ctx.actionType}`,
      };
    }
    if (rule.max_cost_usd != null && ctx.costUsd != null && ctx.costUsd > rule.max_cost_usd) {
      return {
        allow: false,
        rule,
        policy,
        reason: `Policy "${policy.name}" caps ${ctx.actionType} at $${rule.max_cost_usd}; current $${ctx.costUsd.toFixed(2)}`,
      };
    }

    return { allow: true, rule, policy };
  }

  return { allow: true, rule: null, policy: null };
}

/** Risk level recorded on a derived approval request when the matched rule
 *  doesn't carry one (shouldn't happen — rules always have risk_level). */
export function fallbackRiskFor(action: ActionType): RiskLevel {
  switch (action) {
    case "delete_data":
      return "critical";
    case "send_email":
    case "send_message":
    case "contact_customer":
    case "deploy_code":
    case "merge_pr":
    case "modify_production":
    case "use_secret":
    case "external_api_call":
    case "create_handoff":
    case "custom":
      return "high";
    case "spend_money":
      return "medium";
    case "update_status":
    default:
      return "low";
  }
}
