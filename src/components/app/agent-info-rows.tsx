/**
 * Pure helper that produces the cli-specific info rows for the agent
 * detail page. Separated from the page component so the row-selection
 * logic is unit-testable without spinning up a React renderer.
 */

export type AgentForInfoRows = {
  type: string;
  cli: string | null;
  model: string | null;
  thinking?: string | null;
  api_base_url?: string | null;
  api_key_env?: string | null;
};

export type AgentInfoRow = {
  key: string;
  iconName: "model" | "thinking" | "api-url" | "api-env";
  value: string;
  title?: string;
  monospace?: boolean;
};

/** Returns the cli-specific rows that belong in the info grid. The
 *  caller renders icon + value using its own lucide imports. */
export function agentInfoRows(agent: AgentForInfoRows): AgentInfoRow[] {
  const rows: AgentInfoRow[] = [];
  if (agent.type !== "harbour") return rows;

  if (agent.model) {
    rows.push({ key: "model", iconName: "model", value: agent.model });
  }

  // Thinking row applies to CLI providers that have a reasoning knob;
  // api agents don't (model selection drives reasoning depth there).
  if (agent.cli && agent.cli !== "api") {
    rows.push({ key: "thinking", iconName: "thinking", value: agent.thinking || "Default" });
  }

  if (agent.cli === "api") {
    if (agent.api_base_url) {
      rows.push({
        key: "api-base",
        iconName: "api-url",
        value: agent.api_base_url,
        title: agent.api_base_url,
        monospace: true,
      });
    }
    if (agent.api_key_env) {
      rows.push({
        key: "api-env",
        iconName: "api-env",
        value: `$${agent.api_key_env}`,
        title: `Runner reads API key from $${agent.api_key_env}`,
        monospace: true,
      });
    }
  }

  return rows;
}
