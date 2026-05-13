/**
 * Captain spawns CLIs in a working directory derived from the captain_cwd
 * setting. Defense-in-depth: that cwd must stay under HARBOUR_HOME so a
 * misconfigured setting (or compromised admin) cannot make Captain run a CLI
 * in /etc, /var/www, etc., or write CLAUDE.md into arbitrary directories.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

let originalHome: string | undefined;
let tmpHome: string;

beforeEach(() => {
  originalHome = process.env.HARBOUR_HOME;
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "harbour-captain-cwd-"));
  process.env.HARBOUR_HOME = tmpHome;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HARBOUR_HOME;
  else process.env.HARBOUR_HOME = originalHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("captain cwd guard", () => {
  it("rejects cwd outside HARBOUR_HOME with a clear error", async () => {
    const { spawn } = await import("@/lib/captain/process-manager");
    // Pick an out-of-tree dir that exists so the error is the GUARD, not
    // a missing-directory failure.
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "harbour-outside-"));
    try {
      await expect(
        spawn({
          conversationId: "c-1",
          messageId: "m-1",
          prompt: "hi",
          cli: "claude",
          model: null,
          thinking: null,
          sessionId: null,
          isNewSession: true,
          cwd: outsideDir,
        }),
      ).rejects.toThrow(/HARBOUR_HOME/);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("accepts cwd inside HARBOUR_HOME (no guard error; failure must come from CLI not found, not the guard)", async () => {
    const { spawn } = await import("@/lib/captain/process-manager");
    const insideDir = path.join(tmpHome, "captain-inside");
    fs.mkdirSync(insideDir, { recursive: true });
    // We can't easily complete a full spawn here (no Claude CLI in CI), but
    // the guard check happens BEFORE getProvider/runCliTool. The spawn either
    // succeeds (unlikely without the CLI installed) or fails for a different
    // reason — what matters is that the error is NOT the HARBOUR_HOME guard.
    let caught: Error | null = null;
    try {
      await spawn({
        conversationId: "c-ok",
        messageId: "m-ok",
        prompt: "hi",
        cli: "claude",
        model: null,
        thinking: null,
        sessionId: null,
        isNewSession: true,
        cwd: insideDir,
      });
    } catch (err) {
      caught = err as Error;
    }
    if (caught) {
      expect(caught.message).not.toMatch(/HARBOUR_HOME/);
    }
  });
});
