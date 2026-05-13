/**
 * Tests for the TS mirror of safe-settings validation. The runner uses a
 * plain-JS copy in bin/lib/safe-settings.mjs; this validator drives the
 * server-side security panel + settings PUT API.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { validateClaudeSettingsPath } from "@/lib/claude-settings";

let tmpDir: string;
let settingsPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "harbour-safe-"));
  settingsPath = path.join(tmpDir, "settings.json");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("validateClaudeSettingsPath", () => {
  it("accepts a well-formed file with a permissions object", () => {
    fs.writeFileSync(settingsPath, JSON.stringify({ permissions: { defaultMode: "dontAsk", deny: [] } }));
    expect(validateClaudeSettingsPath(settingsPath)).toEqual({ ok: true });
  });

  it("rejects a missing file", () => {
    const r = validateClaudeSettingsPath(settingsPath);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/missing/);
  });

  it("rejects a zero-byte file", () => {
    fs.writeFileSync(settingsPath, "");
    const r = validateClaudeSettingsPath(settingsPath);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/empty/);
  });

  it("rejects malformed JSON", () => {
    fs.writeFileSync(settingsPath, "{ not json");
    const r = validateClaudeSettingsPath(settingsPath);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not valid JSON/);
  });

  it("rejects JSON without a top-level permissions object", () => {
    fs.writeFileSync(settingsPath, JSON.stringify({ model: "sonnet" }));
    const r = validateClaudeSettingsPath(settingsPath);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/permissions/);
  });

  it("rejects a symlink (defense in depth)", () => {
    const target = path.join(tmpDir, "real.json");
    fs.writeFileSync(target, JSON.stringify({ permissions: {} }));
    fs.symlinkSync(target, settingsPath);
    const r = validateClaudeSettingsPath(settingsPath);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/symlink/);
  });
});
