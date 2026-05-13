/**
 * Provider capability metadata invariants. These flags drive UI banners
 * and runtime branching, so they need to stay in sync between
 * src/lib/cli-config.ts and bin/lib/providers.mjs (kept in lockstep by
 * hand).
 */
import { describe, it, expect } from "vitest";
import { CLI_CONFIG, API_PRESETS } from "@/lib/cli-config";

describe("provider capabilities (server)", () => {
  it("every entry declares the four capability flags + safety notes", () => {
    for (const [id, cfg] of Object.entries(CLI_CONFIG)) {
      const c = cfg.capabilities;
      expect(typeof c.supportsNativePermissions, `${id}.supportsNativePermissions`).toBe("boolean");
      expect(typeof c.supportsHarbourSafeMode, `${id}.supportsHarbourSafeMode`).toBe("boolean");
      expect(typeof c.requiresBypassForNonInteractive, `${id}.requiresBypassForNonInteractive`).toBe("boolean");
      expect(typeof c.hasShellAccess, `${id}.hasShellAccess`).toBe("boolean");
      expect(typeof c.safetyNotes, `${id}.safetyNotes`).toBe("string");
      expect(c.safetyNotes.length, `${id}.safetyNotes non-empty`).toBeGreaterThan(0);
    }
  });

  it("Claude is the only provider with a native permission system", () => {
    expect(CLI_CONFIG.claude.capabilities.supportsNativePermissions).toBe(true);
    for (const id of ["codex", "gemini", "shell", "api"]) {
      expect(CLI_CONFIG[id].capabilities.supportsNativePermissions, id).toBe(false);
    }
  });

  it("API agent has no shell access", () => {
    expect(CLI_CONFIG.api.capabilities.hasShellAccess).toBe(false);
  });

  it("Shell-capable providers all support Harbour-level safe mode", () => {
    for (const id of ["claude", "codex", "gemini", "shell", "api"]) {
      expect(CLI_CONFIG[id].capabilities.supportsHarbourSafeMode, id).toBe(true);
    }
  });

  it("Codex and Gemini require bypass flags for non-interactive runs", () => {
    expect(CLI_CONFIG.codex.capabilities.requiresBypassForNonInteractive).toBe(true);
    expect(CLI_CONFIG.gemini.capabilities.requiresBypassForNonInteractive).toBe(true);
    expect(CLI_CONFIG.shell.capabilities.requiresBypassForNonInteractive).toBe(false);
    expect(CLI_CONFIG.api.capabilities.requiresBypassForNonInteractive).toBe(false);
  });

  it("API_PRESETS ship a base URL, model, and env-var name for every preset", () => {
    expect(API_PRESETS.length).toBeGreaterThanOrEqual(3);
    for (const p of API_PRESETS) {
      expect(p.apiBaseUrl).toMatch(/^https?:\/\//);
      expect(p.defaultModel).toBeTruthy();
      expect(p.defaultApiKeyEnv).toBeTruthy();
    }
  });
});
