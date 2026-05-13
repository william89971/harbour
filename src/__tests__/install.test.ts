/**
 * Pure unit-string tests for the agent runner install templates. These cover
 * the platform-specific bits we'd otherwise only learn about by reading the
 * generated file on disk — placeholder substitution, required directives,
 * 60-second cadence. Side-effecting paths (writing files, invoking
 * launchctl/systemctl) are integration territory and live outside this suite.
 */
import { describe, it, expect } from "vitest";
import { buildSystemdService, buildSystemdTimer, buildPlist, isRunnerInstalled } from "../../bin/lib/install.mjs";

describe("systemd unit files", () => {
  it("service file exec-starts node + harbour.mjs with required directives", () => {
    const out = buildSystemdService({
      nodePath: "/usr/bin/node",
      harbourBin: "/home/u/harbour/bin/harbour.mjs",
      home: "/home/u",
      repoRoot: "/home/u/harbour",
    });
    expect(out).toContain("[Unit]");
    expect(out).toContain("[Service]");
    expect(out).toContain("Type=oneshot");
    expect(out).toContain("ExecStart=/usr/bin/node /home/u/harbour/bin/harbour.mjs agent run");
    expect(out).toContain("WorkingDirectory=/home/u/harbour");
    expect(out).toContain("Environment=HOME=/home/u");
    expect(out).toContain("Environment=PATH=");
    expect(out).toContain("StandardOutput=journal");
    expect(out).toContain("StandardError=journal");
  });

  it("PATH includes common Linux + macOS-Homebrew + user-local bin", () => {
    const out = buildSystemdService({
      nodePath: "/usr/bin/node",
      harbourBin: "/home/u/harbour/bin/harbour.mjs",
      home: "/home/u",
      repoRoot: "/home/u/harbour",
    });
    expect(out).toContain("/usr/local/bin");
    expect(out).toContain("/usr/bin");
    expect(out).toContain("/opt/homebrew/bin");
    expect(out).toContain("/home/u/.local/bin");
  });

  it("timer file has 60s cadence with persistence and timers.target install", () => {
    const out = buildSystemdTimer();
    expect(out).toContain("[Timer]");
    expect(out).toContain("OnUnitActiveSec=60s");
    expect(out).toContain("OnBootSec=10s");
    expect(out).toContain("Persistent=true");
    expect(out).toContain("[Install]");
    expect(out).toContain("WantedBy=timers.target");
    expect(out).toContain("Unit=harbour-agent-runner.service");
    expect(out).toContain("Requires=harbour-agent-runner.service");
  });

  it("timer file is stable across calls (deterministic output)", () => {
    expect(buildSystemdTimer()).toBe(buildSystemdTimer());
  });

  it("timer file honors a custom interval", () => {
    const out = buildSystemdTimer(30);
    expect(out).toContain("OnUnitActiveSec=30s");
    expect(out).toContain("every 30 seconds");
  });

  it("timer file at default interval keeps the 60s baseline", () => {
    const out = buildSystemdTimer(60);
    expect(out).toContain("OnUnitActiveSec=60s");
    expect(out).toContain("every 60 seconds");
  });
});

describe("launchd plist", () => {
  it("includes the label, node path, harbour bin, and 60-second cadence", () => {
    const out = buildPlist({
      nodePath: "/opt/homebrew/bin/node",
      plistLabel: "com.harbour.agent-runner",
      logPath: "/Users/u/.harbour/runner.log",
      errLogPath: "/Users/u/.harbour/runner.err.log",
      home: "/Users/u",
      pathEnv: "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin",
    });
    expect(out).toContain("<string>com.harbour.agent-runner</string>");
    expect(out).toContain("<string>/opt/homebrew/bin/node</string>");
    expect(out).toContain("<string>agent</string>");
    expect(out).toContain("<string>run</string>");
    expect(out).toContain("<integer>60</integer>");
    expect(out).toContain("<string>/Users/u/.harbour/runner.log</string>");
    expect(out).toContain("<string>/Users/u/.harbour/runner.err.log</string>");
    expect(out).toContain("<key>PATH</key>");
    expect(out).toContain("<key>HOME</key>");
    expect(out).toContain("<string>/Users/u</string>");
  });

  it("plist honors a custom interval", () => {
    const out = buildPlist({
      nodePath: "/usr/bin/node",
      plistLabel: "com.harbour.agent-runner",
      logPath: "/log",
      errLogPath: "/err",
      home: "/h",
      pathEnv: "/usr/bin",
      intervalSeconds: 15,
    });
    expect(out).toContain("<integer>15</integer>");
    expect(out).not.toContain("<integer>60</integer>");
  });
});

describe("isRunnerInstalled", () => {
  // Smoke check: function returns a boolean and doesn't throw, regardless of
  // whether a real scheduler unit is on this host. Drives the new auto-
  // reinstall behavior of `agent interval N` in harbour.mjs.
  it("returns a boolean without throwing", () => {
    const result = isRunnerInstalled();
    expect(typeof result).toBe("boolean");
  });
});
