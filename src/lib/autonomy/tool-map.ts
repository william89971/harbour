import type { ActionType } from "./constants";

/**
 * Maps API-agent tool names (from `src/lib/db/agents.ts::TOOL_NAMES`) to
 * autonomy action types. Tools not listed here are non-gated — read_docs /
 * read_databases / post_activity are observational and never block.
 */
export const TOOL_ACTION_MAP: Record<string, ActionType> = {
  write_docs: "modify_production",
  write_databases: "modify_production",
  read_env_vars: "use_secret",
  create_runs: "update_status",
  create_handoffs: "create_handoff",
  update_status: "update_status",
  use_shell: "external_api_call",
};

export function actionTypeForTool(toolName: string): ActionType | null {
  return TOOL_ACTION_MAP[toolName] ?? null;
}
