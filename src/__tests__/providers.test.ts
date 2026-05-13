import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { getProvider, runCliTool } from "../../bin/lib/providers.mjs";

// These tests assert the argv shape produced by each provider's buildCommand.
// They guard against silent flag drift in the upstream CLIs (issue #24 was
// caused by Gemini 0.40 dropping --thinking and Codex 0.128 dropping
// --reasoning-effort). When upgrading a CLI, update both the provider and
// these expectations together so the change is visible in review.

const CWD = "/tmp/test-workspace";
const PROMPT = "do the thing";

// Small adapter so tests stay readable with the new opts-object signature.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function build(provider: any, prompt: string, model: string | null, workingDir: string, sessionId: string | null, isNewSession: boolean, thinking: string | null, runner: Record<string, unknown> = {}) {
  return provider.buildCommand({ prompt, model, workingDir, sessionId, isNewSession, thinking, runner });
}

describe("claude provider", () => {
  const claude = getProvider("claude");

  it("builds a basic command without thinking", () => {
    const cmd = build(claude, PROMPT, "sonnet", CWD, "abc-123", true, null);
    expect(cmd.cwd).toBe(CWD);
    expect(cmd.args).toContain("-p");
    expect(cmd.args).toContain(PROMPT);
    expect(cmd.args).toContain("--model");
    expect(cmd.args).toContain("sonnet");
    expect(cmd.args).not.toContain("--effort");
  });

  it("passes thinking via --effort", () => {
    const cmd = build(claude, PROMPT, "sonnet", CWD, "abc-123", true, "high");
    expect(cmd.args).toContain("--effort");
    const effortIdx = cmd.args.indexOf("--effort");
    expect(cmd.args[effortIdx + 1]).toBe("high");
  });

  it("uses --session-id for new sessions and --resume for existing", () => {
    const fresh = build(claude, PROMPT, "sonnet", CWD, "uuid-1", true, null);
    expect(fresh.args).toContain("--session-id");
    expect(fresh.args).not.toContain("--resume");

    const resume = build(claude, PROMPT, "sonnet", CWD, "uuid-1", false, null);
    expect(resume.args).toContain("--resume");
    expect(resume.args).not.toContain("--session-id");
  });

  it("adds --dangerously-skip-permissions in unrestricted mode", () => {
    const cmd = claude.buildCommand({ prompt: PROMPT, model: "sonnet", workingDir: CWD, sessionId: "x", isNewSession: true, thinking: null, permissionMode: "unrestricted" });
    expect(cmd.args).toContain("--dangerously-skip-permissions");
  });

  it("omits the skip flag in safe mode when settings.json is valid", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harbour-claude-"));
    try {
      fs.mkdirSync(path.join(dir, ".claude"));
      fs.writeFileSync(path.join(dir, ".claude", "settings.json"), JSON.stringify({ permissions: { defaultMode: "dontAsk" } }));
      const cmd = claude.buildCommand({ prompt: PROMPT, model: "sonnet", workingDir: dir, sessionId: "x", isNewSession: true, thinking: null, permissionMode: "safe" });
      expect(cmd.args).not.toContain("--dangerously-skip-permissions");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws in safe mode when settings.json is missing (no silent fallback)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harbour-claude-"));
    try {
      expect(() => claude.buildCommand({ prompt: PROMPT, model: "sonnet", workingDir: dir, sessionId: "x", isNewSession: true, thinking: null, permissionMode: "safe" }))
        .toThrow(/missing/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws in custom mode when settings.json is malformed", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harbour-claude-"));
    try {
      fs.mkdirSync(path.join(dir, ".claude"));
      fs.writeFileSync(path.join(dir, ".claude", "settings.json"), "{ not json");
      expect(() => claude.buildCommand({ prompt: PROMPT, model: "sonnet", workingDir: dir, sessionId: "x", isNewSession: true, thinking: null, permissionMode: "custom" }))
        .toThrow(/not valid JSON|JSON/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("non-Claude shell-CLI providers accept safe/custom mode now", () => {
  it("codex builds safely in safe mode (no longer throws)", () => {
    const codex = getProvider("codex");
    const cmd = codex.buildCommand({ prompt: PROMPT, model: "gpt-5.5", workingDir: CWD, sessionId: null, thinking: "low", permissionMode: "safe" });
    expect(cmd.binary).toBeTruthy();
    // Codex still passes its bypass flag in every mode — Harbour-level
    // safety is provided by the shim PATH the runner installs, not by
    // dropping the bypass flag.
    expect(cmd.args).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(cmd.harbourSafeMode).toBe(true);
  });

  it("gemini builds in safe mode and flags harbourSafeMode", () => {
    const gemini = getProvider("gemini");
    const cmd = gemini.buildCommand({ prompt: PROMPT, model: "gemini-2.5-pro", workingDir: CWD, sessionId: null, permissionMode: "safe" });
    expect(cmd.args).toContain("--yolo");
    expect(cmd.harbourSafeMode).toBe(true);
  });

  it("codex in unrestricted mode does not set harbourSafeMode", () => {
    const codex = getProvider("codex");
    const cmd = codex.buildCommand({ prompt: PROMPT, model: "gpt-5.5", workingDir: CWD, sessionId: null, thinking: "low", permissionMode: "unrestricted" });
    expect(cmd.harbourSafeMode).toBe(false);
  });
});

describe("api provider", () => {
  it("returns the useApiAgent sentinel from buildCommand", () => {
    const api = getProvider("api");
    const cmd = api.buildCommand({
      prompt: PROMPT,
      model: "deepseek-chat",
      workingDir: CWD,
      runner: { apiBaseUrl: "https://api.deepseek.com/v1", apiKeyEnv: "DEEPSEEK_API_KEY" },
      permissionMode: "safe",
    });
    expect(cmd.useApiAgent).toBe(true);
    expect(cmd.apiBaseUrl).toBe("https://api.deepseek.com/v1");
    expect(cmd.apiKeyEnv).toBe("DEEPSEEK_API_KEY");
    expect(cmd.model).toBe("deepseek-chat");
  });

  it("declares no shell access in capabilities", () => {
    const api = getProvider("api");
    expect(api.capabilities.hasShellAccess).toBe(false);
  });
});

describe("codex provider (issue #24)", () => {
  const codex = getProvider("codex");

  it("does NOT use the removed --reasoning-effort flag", () => {
    const cmd = build(codex, PROMPT, "gpt-5", CWD, null, true, "low");
    expect(cmd.args).not.toContain("--reasoning-effort");
  });

  it("passes thinking via -c model_reasoning_effort=<level> on a fresh session", () => {
    const cmd = build(codex, PROMPT, "gpt-5", CWD, null, true, "high");
    expect(cmd.args).toContain("-c");
    expect(cmd.args).toContain("model_reasoning_effort=high");
    // The -c and its value must be adjacent
    const cIdx = cmd.args.indexOf("-c");
    expect(cmd.args[cIdx + 1]).toBe("model_reasoning_effort=high");
  });

  it("passes thinking via -c on a resumed session", () => {
    const cmd = build(codex, PROMPT, "gpt-5", CWD, "session-uuid", false, "medium");
    expect(cmd.args[0]).toBe("exec");
    expect(cmd.args[1]).toBe("resume");
    expect(cmd.args).toContain("-c");
    expect(cmd.args).toContain("model_reasoning_effort=medium");
    expect(cmd.args).not.toContain("--reasoning-effort");
    // Session id and prompt must be the trailing positional args
    expect(cmd.args[cmd.args.length - 2]).toBe("session-uuid");
    expect(cmd.args[cmd.args.length - 1]).toBe(PROMPT);
  });

  it("omits -c when no thinking value is set", () => {
    const cmd = build(codex, PROMPT, "gpt-5", CWD, null, true, null);
    expect(cmd.args).not.toContain("-c");
  });
});

describe("gemini provider (issue #24)", () => {
  const gemini = getProvider("gemini");

  it("does NOT use the removed --thinking flag", () => {
    const cmd = build(gemini, PROMPT, "gemini-2.5-pro", CWD, null, true, "low");
    expect(cmd.args).not.toContain("--thinking");
  });

  it("includes --skip-trust for headless mode in non-trusted workspaces", () => {
    const cmd = build(gemini, PROMPT, "gemini-2.5-pro", CWD, null, true, null);
    expect(cmd.args).toContain("--skip-trust");
  });

  it("ignores any thinking value the caller passes", () => {
    // Existing agents may have a stale `thinking` saved in the DB; the runner
    // still passes it to buildCommand. The provider must drop it silently.
    const cmd = build(gemini, PROMPT, "gemini-2.5-pro", CWD, null, true, "high");
    expect(cmd.args).not.toContain("--thinking");
    expect(cmd.args).not.toContain("high");
  });

  it("passes the prompt and model", () => {
    const cmd = build(gemini, PROMPT, "gemini-2.5-pro", CWD, null, true, null);
    expect(cmd.args).toContain("--prompt");
    const pIdx = cmd.args.indexOf("--prompt");
    expect(cmd.args[pIdx + 1]).toBe(PROMPT);
    expect(cmd.args).toContain("-m");
    expect(cmd.args).toContain("gemini-2.5-pro");
    expect(cmd.args).toContain("--yolo");
    expect(cmd.args).toContain("-o");
    expect(cmd.args).toContain("stream-json");
  });

  it("passes --resume for existing sessions", () => {
    const cmd = build(gemini, PROMPT, "gemini-2.5-pro", CWD, "session-uuid", false, null);
    expect(cmd.args).toContain("--resume");
    const rIdx = cmd.args.indexOf("--resume");
    expect(cmd.args[rIdx + 1]).toBe("session-uuid");
  });
});

describe("provider registry metadata", () => {
  it("every provider exposes id, displayName, and buildCommand", () => {
    for (const id of ["claude", "codex", "gemini", "shell"]) {
      const p = getProvider(id);
      expect(p.id).toBe(id);
      expect(typeof p.displayName).toBe("string");
      expect(p.displayName.length).toBeGreaterThan(0);
      expect(typeof p.buildCommand).toBe("function");
      expect(Array.isArray(p.supportedModels)).toBe(true);
      expect(p.supportedThinking).toHaveProperty("options");
    }
  });

  it("checkAvailable returns a boolean for every provider", () => {
    for (const id of ["claude", "codex", "gemini", "shell"]) {
      const p = getProvider(id);
      expect(typeof p.checkAvailable()).toBe("boolean");
    }
    // shell is always available
    expect(getProvider("shell").checkAvailable()).toBe(true);
  });
});

describe("shell provider", () => {
  const shell = getProvider("shell");

  it("buildCommand returns sh -c with stdinPayload", () => {
    const cmd = shell.buildCommand({
      prompt: "hello\nworld",
      runner: { shellCommand: "cat", shellCwd: "/tmp" },
      workingDir: "/fallback",
    });
    expect(cmd.binary).toBe("sh");
    expect(cmd.args).toEqual(["-c", "cat"]);
    expect(cmd.cwd).toBe("/tmp");
    expect(cmd.stdinPayload).toBe("hello\nworld");
  });

  it("falls back to workingDir when shellCwd is unset", () => {
    const cmd = shell.buildCommand({
      prompt: "x",
      runner: { shellCommand: "echo ok" },
      workingDir: "/fallback",
    });
    expect(cmd.cwd).toBe("/fallback");
  });

  it("throws when shellCommand is missing or blank", () => {
    expect(() => shell.buildCommand({ prompt: "x", runner: {}, workingDir: "/" })).toThrow();
    expect(() => shell.buildCommand({ prompt: "x", runner: { shellCommand: "   " }, workingDir: "/" })).toThrow();
  });

  it("parseLine emits text_delta per stdout line", () => {
    const out = shell.parseLine("first line");
    expect(out.events).toEqual([{ event_type: "text_delta", content: "first line\n" }]);
  });

  it("parseResult returns stdout content with no usage and null sessionId", () => {
    const out = shell.parseResult("the output");
    expect(out.content).toBe("the output");
    expect(out.sessionId).toBeNull();
    expect(out.usage).toBeNull();
  });

  it("end-to-end: pipes prompt to a real shell command via runCliTool", async () => {
    const result = await runCliTool("sh", ["-c", "cat"], process.cwd(), {
      stdinPayload: "the prompt goes here",
      timeoutMs: 5000,
    });
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe("the prompt goes here");
  });

  it("end-to-end: non-zero exit is surfaced in the result code", async () => {
    const result = await runCliTool("sh", ["-c", "exit 3"], process.cwd(), {
      stdinPayload: "",
      timeoutMs: 5000,
    });
    expect(result.code).toBe(3);
  });
});
