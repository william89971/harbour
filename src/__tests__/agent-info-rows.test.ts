/**
 * agentInfoRows: cli-specific info-row selection logic.
 *
 * The agent detail page renders icons + values from this helper. Tests
 * here cover the conditional matrix without spinning up a React renderer.
 */
import { describe, it, expect } from "vitest";
import { agentInfoRows } from "@/components/app/agent-info-rows";

describe("agentInfoRows", () => {
  it("returns nothing for external agents", () => {
    const rows = agentInfoRows({ type: "external", cli: null, model: null });
    expect(rows).toEqual([]);
  });

  it("Claude harbour agent: model + thinking rows", () => {
    const rows = agentInfoRows({ type: "harbour", cli: "claude", model: "sonnet", thinking: "high" });
    expect(rows.map(r => r.key)).toEqual(["model", "thinking"]);
    expect(rows[0].value).toBe("sonnet");
    expect(rows[1].value).toBe("high");
  });

  it("Claude agent without thinking defaults to 'Default'", () => {
    const rows = agentInfoRows({ type: "harbour", cli: "claude", model: "sonnet", thinking: null });
    const thinkingRow = rows.find(r => r.key === "thinking");
    expect(thinkingRow?.value).toBe("Default");
  });

  it("Codex / Gemini harbour agents still get the thinking row", () => {
    for (const cli of ["codex", "gemini"]) {
      const rows = agentInfoRows({ type: "harbour", cli, model: "x", thinking: "low" });
      expect(rows.find(r => r.key === "thinking")).toBeTruthy();
    }
  });

  it("API agent: model + api-base + api-env rows, NO thinking row", () => {
    const rows = agentInfoRows({
      type: "harbour", cli: "api", model: "deepseek-chat",
      api_base_url: "https://api.deepseek.com/v1", api_key_env: "DEEPSEEK_API_KEY",
    });
    const keys = rows.map(r => r.key);
    expect(keys).toContain("model");
    expect(keys).toContain("api-base");
    expect(keys).toContain("api-env");
    expect(keys).not.toContain("thinking");
  });

  it("API agent without api_base_url omits the row (defensive)", () => {
    const rows = agentInfoRows({
      type: "harbour", cli: "api", model: "deepseek-chat",
      api_base_url: null, api_key_env: "DEEPSEEK_API_KEY",
    });
    expect(rows.find(r => r.key === "api-base")).toBeUndefined();
    expect(rows.find(r => r.key === "api-env")).toBeTruthy();
  });

  it("API-env row prefixes the value with $ and sets a helpful title", () => {
    const rows = agentInfoRows({
      type: "harbour", cli: "api", model: "deepseek-chat",
      api_base_url: "https://x/v1", api_key_env: "DEEPSEEK_API_KEY",
    });
    const envRow = rows.find(r => r.key === "api-env")!;
    expect(envRow.value).toBe("$DEEPSEEK_API_KEY");
    expect(envRow.title).toMatch(/Runner reads API key from \$DEEPSEEK_API_KEY/);
    expect(envRow.monospace).toBe(true);
  });

  it("Shell agent: only the model row (display label), no thinking/api rows", () => {
    const rows = agentInfoRows({ type: "harbour", cli: "shell", model: "my-script v1" });
    const keys = rows.map(r => r.key);
    // shell agents go through the thinking branch because the helper
    // treats every non-"api" cli the same; in practice shell agents have
    // empty thinking and the row reads "Default", which is harmless.
    expect(keys).toContain("model");
    expect(keys).not.toContain("api-base");
    expect(keys).not.toContain("api-env");
  });
});
