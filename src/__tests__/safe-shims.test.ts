/**
 * Safe-mode shim wrappers.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { execSync } from "child_process";
import { installSafeShims, safeModePath, DENIED_COMMANDS, safeShimDir } from "../../bin/lib/safe-shims.mjs";

let originalHome: string | undefined;
let tmpHome: string;

beforeEach(() => {
  originalHome = process.env.HARBOUR_HOME;
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "harbour-shims-"));
  process.env.HARBOUR_HOME = tmpHome;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HARBOUR_HOME;
  else process.env.HARBOUR_HOME = originalHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("installSafeShims", () => {
  it("writes a shim per denied command + a curl shim", () => {
    const dir = installSafeShims();
    expect(dir).toBe(safeShimDir());
    for (const cmd of DENIED_COMMANDS) {
      const p = path.join(dir, cmd);
      expect(fs.existsSync(p)).toBe(true);
      const st = fs.statSync(p);
      expect(st.mode & 0o100).not.toBe(0); // executable by owner
    }
    expect(fs.existsSync(path.join(dir, "curl"))).toBe(true);
  });

  it("is idempotent — calling twice does not error", () => {
    installSafeShims();
    expect(() => installSafeShims()).not.toThrow();
  });

  it("each shim exits non-zero with the harbour-safe-mode message", () => {
    const dir = installSafeShims();
    for (const cmd of DENIED_COMMANDS) {
      const p = path.join(dir, cmd);
      let failed = false;
      let stderr = "";
      try {
        execSync(`${p} --any-arg`, { stdio: ["ignore", "pipe", "pipe"] });
      } catch (err) {
        failed = true;
        stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? "";
      }
      expect(failed, `${cmd} shim should fail`).toBe(true);
      expect(stderr, `${cmd} stderr should mention harbour-safe-mode`).toContain("harbour-safe-mode");
    }
  });

  it("curl shim is python3-free (uses pure bash for PATH filtering)", () => {
    const dir = installSafeShims();
    const body = fs.readFileSync(path.join(dir, "curl"), "utf-8");
    // Hard python3 dependency would break minimal Linux images.
    expect(body).not.toContain("python3");
    expect(body).not.toContain("python ");
    // Sanity: it still actually does PATH filtering before exec-ing curl.
    expect(body).toContain("FILTERED_PATH");
    expect(body).toContain("exec curl");
  });

  it("curl shim blocks Authorization header", () => {
    const dir = installSafeShims();
    let failed = false;
    let stderr = "";
    try {
      execSync(`${path.join(dir, "curl")} -H "Authorization: Bearer secret" https://example.com`, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      failed = true;
      stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? "";
    }
    expect(failed).toBe(true);
    expect(stderr).toContain("harbour-safe-mode");
  });

  it("curl shim blocks -K config-file flag (cred smuggling vector)", () => {
    const dir = installSafeShims();
    let failed = false;
    let stderr = "";
    try {
      execSync(`${path.join(dir, "curl")} -K /tmp/some-cfg https://example.com`, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      failed = true;
      stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? "";
    }
    expect(failed).toBe(true);
    expect(stderr).toContain("harbour-safe-mode");
    expect(stderr).toContain("config");
  });

  it("curl shim blocks --config and --config=path", () => {
    const dir = installSafeShims();
    for (const arg of ["--config /tmp/x", "--config=/tmp/x"]) {
      let failed = false;
      let stderr = "";
      try {
        execSync(`${path.join(dir, "curl")} ${arg} https://example.com`, { stdio: ["ignore", "pipe", "pipe"] });
      } catch (err) {
        failed = true;
        stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? "";
      }
      expect(failed, `${arg} should be blocked`).toBe(true);
      expect(stderr).toContain("harbour-safe-mode");
    }
  });
});

describe("safeModePath", () => {
  it("puts shim dir BEFORE workspace bin/ so the agent cannot shadow the denylist", () => {
    // The workspace is writable by the running CLI itself — if the workspace
    // bin/ came first, a misbehaving CLI in safe mode could just install its
    // own `bin/rm` to override the shim. Shim dir must come first.
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "harbour-ws-"));
    fs.mkdirSync(path.join(workspace, "bin"));
    try {
      const out = safeModePath(workspace, "/usr/bin");
      const parts = out.split(":");
      expect(parts[0]).toBe(safeShimDir());
      expect(parts[1]).toBe(path.join(workspace, "bin"));
      expect(parts[2]).toBe("/usr/bin");
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("omits workspace bin/ when missing", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "harbour-ws-"));
    try {
      const out = safeModePath(workspace, "/usr/bin");
      const parts = out.split(":");
      expect(parts[0]).toBe(safeShimDir());
      expect(parts[1]).toBe("/usr/bin");
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("end-to-end PATH lookup: shim dir wins over workspace bin/ for denied commands", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "harbour-resolve-"));
    fs.mkdirSync(path.join(workspace, "bin"));
    // Workspace-level rm "override" attempt: the shim must still win.
    fs.writeFileSync(path.join(workspace, "bin", "rm"), "#!/usr/bin/env bash\nexit 42\n", { mode: 0o755 });
    installSafeShims();
    try {
      // Resolve `rm` via PATH lookup using `command -v` in a subshell.
      // With the new order, the shim dir wins.
      const resolved = execSync("command -v rm", {
        env: { ...process.env, PATH: safeModePath(workspace, process.env.PATH || "/usr/bin:/bin") },
      }).toString().trim();
      expect(resolved).toBe(path.join(safeShimDir(), "rm"));

      // Workspace bin/ DOES still take effect for non-denylisted commands.
      fs.writeFileSync(path.join(workspace, "bin", "harbour-helper"), "#!/usr/bin/env bash\necho hi\n", { mode: 0o755 });
      const resolvedHelper = execSync("command -v harbour-helper", {
        env: { ...process.env, PATH: safeModePath(workspace, process.env.PATH || "/usr/bin:/bin") },
      }).toString().trim();
      expect(resolvedHelper).toBe(path.join(workspace, "bin", "harbour-helper"));

      // Allowed commands (e.g. `cat`, `node`) still resolve to real binaries.
      const realCat = execSync("command -v cat", {
        env: { ...process.env, PATH: safeModePath(workspace, process.env.PATH || "/usr/bin:/bin") },
      }).toString().trim();
      expect(realCat).not.toBe(path.join(safeShimDir(), "cat"));
      expect(fs.existsSync(realCat)).toBe(true);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("curl shim does not reference python3 (pure bash PATH filtering)", () => {
    installSafeShims();
    // Recursion avoidance: the shim removes its own directory from PATH
    // before exec-ing the real curl, using pure bash so a minimal image
    // without python3 can still run it.
    const body = fs.readFileSync(path.join(safeShimDir(), "curl"), "utf-8");
    expect(body).not.toContain("python3");
    expect(body).toContain("FILTERED_PATH");
    expect(body).toContain("exec curl");
  });
});
