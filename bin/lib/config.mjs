import fs from "fs";
import path from "path";
import os from "os";

// Paths are derived lazily so tests can swap HARBOUR_HOME between cases.
function harbourDir() {
  return process.env.HARBOUR_HOME || path.join(os.homedir(), ".harbour");
}
function runnersFile() { return path.join(harbourDir(), "runners.json"); }
function sessionsFile() { return path.join(harbourDir(), "sessions.json"); }
function runnerIntervalFile() { return path.join(harbourDir(), "runner-config.json"); }

// Polling-interval bounds. The runner is invoked on a per-host scheduler
// (launchd on macOS, systemd timer on Linux). Lower values reduce delay but
// scale cost linearly — each tick may invoke the LLM.
export const DEFAULT_POLL_INTERVAL_SECONDS = 60;
export const MIN_POLL_INTERVAL_SECONDS = 5;
export const MAX_POLL_INTERVAL_SECONDS = 3600;

export function getHarbourDir() {
  return harbourDir();
}

export function ensureDir() {
  const dir = harbourDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function loadRunnerConfigs() {
  const file = runnersFile();
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")).runners || [];
  } catch {
    return [];
  }
}

// Session tracking: run_id -> { sessionId, cli }
export function loadSessions() {
  const file = sessionsFile();
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return {};
  }
}

export function saveSessions(sessions) {
  ensureDir();
  fs.writeFileSync(sessionsFile(), JSON.stringify(sessions, null, 2));
}

// ---------------------------------------------------------------------------
// Runner polling interval — per-host config that flows into the launchd plist
// / systemd timer at install time. Stored at ~/.harbour/runner-config.json.
// ---------------------------------------------------------------------------

/** Load the polling interval. Returns DEFAULT when the file is missing,
 *  corrupt, or out of range — so a manually-edited bad file never produces
 *  an invalid unit file at install time. */
export function loadRunnerInterval() {
  const file = runnerIntervalFile();
  if (!fs.existsSync(file)) return DEFAULT_POLL_INTERVAL_SECONDS;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
    const n = Number(raw?.pollIntervalSeconds);
    if (!Number.isInteger(n) || n < MIN_POLL_INTERVAL_SECONDS || n > MAX_POLL_INTERVAL_SECONDS) {
      return DEFAULT_POLL_INTERVAL_SECONDS;
    }
    return n;
  } catch {
    return DEFAULT_POLL_INTERVAL_SECONDS;
  }
}

/** Convenience: same as loadRunnerInterval(). */
export function getPollIntervalSeconds() {
  return loadRunnerInterval();
}

/** Throws on out-of-range or non-integer input. */
export function saveRunnerInterval(seconds) {
  const n = Number(seconds);
  if (!Number.isInteger(n) || n < MIN_POLL_INTERVAL_SECONDS || n > MAX_POLL_INTERVAL_SECONDS) {
    throw new Error(`pollIntervalSeconds must be an integer between ${MIN_POLL_INTERVAL_SECONDS} and ${MAX_POLL_INTERVAL_SECONDS}`);
  }
  ensureDir();
  fs.writeFileSync(runnerIntervalFile(), JSON.stringify({ pollIntervalSeconds: n }, null, 2));
}

export function listRunners() {
  const runners = loadRunnerConfigs();
  if (runners.length === 0) {
    console.log("No harbour agents configured.");
    console.log("Create one from the dashboard or with: harbour agent add");
    return;
  }
  console.log(`\n  ${"NAME".padEnd(20)} ${"CLI".padEnd(10)} ${"MODEL".padEnd(15)} ${"THINKING".padEnd(10)} URL`);
  console.log(`  ${"─".repeat(20)} ${"─".repeat(10)} ${"─".repeat(15)} ${"─".repeat(10)} ${"─".repeat(30)}`);
  for (const r of runners) {
    console.log(`  ${(r.name || r.agentId).padEnd(20)} ${(r.cli || "—").padEnd(10)} ${(r.model || "—").padEnd(15)} ${(r.thinking || "—").padEnd(10)} ${r.url}`);
  }
  console.log();
}
