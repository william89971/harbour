import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { getPollIntervalSeconds } from "./config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const harbourBin = path.resolve(__dirname, "..", "harbour.mjs");
const repoRoot = path.resolve(__dirname, "..", "..");

// macOS launchd
const PLIST_LABEL = "com.harbour.agent-runner";
const PLIST_PATH = path.join(os.homedir(), "Library", "LaunchAgents", `${PLIST_LABEL}.plist`);
const HARBOUR_DIR = process.env.HARBOUR_HOME || path.join(os.homedir(), ".harbour");
const LOG_PATH = path.join(HARBOUR_DIR, "runner.log");
const ERR_LOG_PATH = path.join(HARBOUR_DIR, "runner.err.log");

// Linux systemd (user-level)
const SERVICE_NAME = "harbour-agent-runner";
const SERVICE_FILE = `${SERVICE_NAME}.service`;
const TIMER_FILE = `${SERVICE_NAME}.timer`;

function resolveNodePath() {
  try {
    return execSync("which node", { encoding: "utf-8" }).trim();
  } catch {
    return process.execPath;
  }
}

function systemdUserDir() {
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(xdg, "systemd", "user");
}

// ---------------------------------------------------------------------------
// Pure unit-string builders (exported for tests)
// ---------------------------------------------------------------------------

export function buildPlist({ nodePath, plistLabel, logPath, errLogPath, home, pathEnv, intervalSeconds = 60 }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${plistLabel}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${harbourBin}</string>
    <string>agent</string>
    <string>run</string>
  </array>
  <key>StartInterval</key>
  <integer>${intervalSeconds}</integer>
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${errLogPath}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${pathEnv}</string>
    <key>HOME</key>
    <string>${home}</string>
  </dict>
</dict>
</plist>`;
}

export function buildSystemdService({ nodePath, harbourBin: binPath, home, repoRoot: cwd }) {
  return `[Unit]
Description=Harbour agent runner (polls for work)
After=network.target

[Service]
Type=oneshot
ExecStart=${nodePath} ${binPath} agent run
WorkingDirectory=${cwd}
Environment=HOME=${home}
Environment=PATH=/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:${home}/.local/bin
StandardOutput=journal
StandardError=journal
`;
}

export function buildSystemdTimer(intervalSeconds = 60) {
  return `[Unit]
Description=Harbour agent runner timer (every ${intervalSeconds} seconds)
Requires=${SERVICE_FILE}

[Timer]
OnBootSec=10s
OnUnitActiveSec=${intervalSeconds}s
Unit=${SERVICE_FILE}
Persistent=true
AccuracySec=5s

[Install]
WantedBy=timers.target
`;
}

// ---------------------------------------------------------------------------
// macOS launchd implementation
// ---------------------------------------------------------------------------

function installLaunchd() {
  if (fs.existsSync(PLIST_PATH)) {
    console.log("Harbour agent runner is already installed.");
    console.log(`To reinstall, run: harbour agent uninstall && harbour agent install`);
    return;
  }

  const logDir = path.dirname(LOG_PATH);
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

  const intervalSeconds = getPollIntervalSeconds();
  const plist = buildPlist({
    nodePath: resolveNodePath(),
    plistLabel: PLIST_LABEL,
    logPath: LOG_PATH,
    errLogPath: ERR_LOG_PATH,
    home: os.homedir(),
    pathEnv: process.env.PATH || "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin",
    intervalSeconds,
  });
  fs.writeFileSync(PLIST_PATH, plist);

  try {
    execSync(`launchctl load ${PLIST_PATH}`, { stdio: "inherit" });
  } catch {
    console.error("Failed to load launch agent. Try manually: launchctl load " + PLIST_PATH);
    return;
  }

  console.log(`Installed. Harbour agents will be polled every ${intervalSeconds} seconds.`);
  console.log(`Logs: ${LOG_PATH}`);
  console.log(`Status: npm run harbour -- agent status`);
}

function uninstallLaunchd() {
  if (!fs.existsSync(PLIST_PATH)) {
    console.log("Harbour agent runner is not installed.");
    return;
  }

  try {
    execSync(`launchctl unload ${PLIST_PATH}`, { stdio: "inherit" });
  } catch { /* may already be unloaded */ }

  fs.unlinkSync(PLIST_PATH);
  console.log("Uninstalled. Harbour agent runner removed.");
}

function statusLaunchd() {
  if (!fs.existsSync(PLIST_PATH)) {
    console.log("Not installed. Run `npm run harbour -- agent install` to install.");
    return;
  }
  console.log(`Installed at ${PLIST_PATH}`);
  console.log("");
  try {
    const out = execSync(`launchctl list ${PLIST_LABEL}`, { encoding: "utf-8" });
    console.log(out);
  } catch {
    console.log("(launchctl reports the agent is not currently loaded)");
  }
  console.log("");
  console.log(`Stdout: ${LOG_PATH}`);
  console.log(`Stderr: ${ERR_LOG_PATH}`);
  console.log(`Tail:   tail -f ${LOG_PATH}`);
}

// ---------------------------------------------------------------------------
// Linux systemd implementation (user-level — no root, no sudo)
// ---------------------------------------------------------------------------

function ensureSystemctl() {
  try {
    execSync("command -v systemctl", { stdio: "ignore" });
  } catch {
    console.error("systemctl not found. systemd is required for Linux install.");
    console.error("On a non-systemd distro, run `npm run harbour -- agent run` from cron or your preferred supervisor.");
    process.exit(1);
  }
}

function installSystemd() {
  ensureSystemctl();

  const unitDir = systemdUserDir();
  fs.mkdirSync(unitDir, { recursive: true });

  const servicePath = path.join(unitDir, SERVICE_FILE);
  const timerPath = path.join(unitDir, TIMER_FILE);

  if (fs.existsSync(servicePath) && fs.existsSync(timerPath)) {
    console.log("Harbour agent runner is already installed.");
    console.log(`To reinstall, run: harbour agent uninstall && harbour agent install`);
    return;
  }

  const intervalSeconds = getPollIntervalSeconds();
  const service = buildSystemdService({
    nodePath: resolveNodePath(),
    harbourBin,
    home: os.homedir(),
    repoRoot,
  });
  const timer = buildSystemdTimer(intervalSeconds);

  fs.writeFileSync(servicePath, service);
  fs.writeFileSync(timerPath, timer);

  try {
    execSync("systemctl --user daemon-reload", { stdio: "inherit" });
    execSync(`systemctl --user enable --now ${TIMER_FILE}`, { stdio: "inherit" });
  } catch {
    console.error("");
    console.error("Failed to enable/start the timer. If this is a headless server, you may need to enable lingering:");
    console.error(`  loginctl enable-linger ${process.env.USER || "<your-user>"}`);
    console.error("…then re-run the install. enable-linger lets user services keep running after logout.");
    process.exit(1);
  }

  console.log(`Installed. Harbour agents will be polled every ${intervalSeconds} seconds.`);
  console.log(`  Service: ${servicePath}`);
  console.log(`  Timer:   ${timerPath}`);
  console.log(`  Logs:    journalctl --user -u ${SERVICE_FILE} -f`);
  console.log(`  Status:  npm run harbour -- agent status`);
  console.log("");
  console.log("Headless-server tip: if the runner stops after you log out, enable lingering:");
  console.log(`  loginctl enable-linger ${process.env.USER || "<your-user>"}`);
}

function uninstallSystemd() {
  const unitDir = systemdUserDir();
  const servicePath = path.join(unitDir, SERVICE_FILE);
  const timerPath = path.join(unitDir, TIMER_FILE);

  if (!fs.existsSync(servicePath) && !fs.existsSync(timerPath)) {
    console.log("Harbour agent runner is not installed.");
    return;
  }

  try { execSync(`systemctl --user disable --now ${TIMER_FILE}`, { stdio: "ignore" }); } catch { /* not enabled */ }
  try { execSync(`systemctl --user stop ${SERVICE_FILE}`, { stdio: "ignore" }); } catch { /* not running */ }

  for (const p of [timerPath, servicePath]) {
    try { fs.unlinkSync(p); } catch { /* already gone */ }
  }

  try { execSync("systemctl --user daemon-reload", { stdio: "ignore" }); } catch { /* tolerable */ }

  console.log("Uninstalled. Harbour agent runner removed.");
}

function statusSystemd() {
  const unitDir = systemdUserDir();
  const servicePath = path.join(unitDir, SERVICE_FILE);
  const timerPath = path.join(unitDir, TIMER_FILE);
  const installed = fs.existsSync(timerPath) && fs.existsSync(servicePath);
  if (!installed) {
    console.log("Not installed. Run `npm run harbour -- agent install` to install.");
    return;
  }
  console.log("Installed under systemd (--user).");
  console.log(`  Service: ${servicePath}`);
  console.log(`  Timer:   ${timerPath}`);
  console.log("");
  try {
    const out = execSync(`systemctl --user status ${TIMER_FILE} --no-pager`, { encoding: "utf-8" });
    console.log(out);
  } catch (err) {
    console.log(err.stdout?.toString?.() || err.message);
  }
  console.log("");
  console.log(`Logs:        journalctl --user -u ${SERVICE_FILE} -f`);
  console.log(`Last run:    journalctl --user -u ${SERVICE_FILE} -n 50 --no-pager`);
  console.log(`Trigger now: systemctl --user start ${SERVICE_FILE}`);
}

// ---------------------------------------------------------------------------
// Public entry points — dispatch by os.platform()
// ---------------------------------------------------------------------------

export function installRunner() {
  const platform = os.platform();
  if (platform === "darwin") return installLaunchd();
  if (platform === "linux") return installSystemd();
  console.error(`Unsupported platform: ${platform}.`);
  console.error("Run `npm run harbour -- agent run` manually, or supervise it with cron / your preferred tool.");
  process.exit(1);
}

export function uninstallRunner() {
  const platform = os.platform();
  if (platform === "darwin") return uninstallLaunchd();
  if (platform === "linux") return uninstallSystemd();
  console.error(`Unsupported platform: ${platform}.`);
  process.exit(1);
}

export function statusRunner() {
  const platform = os.platform();
  if (platform === "darwin") return statusLaunchd();
  if (platform === "linux") return statusSystemd();
  console.error(`Unsupported platform: ${platform}. The runner is only auto-installed on macOS and Linux.`);
  process.exit(1);
}

/**
 * Lightweight check: is the scheduler unit file present? Used by
 * `agent interval N` to decide whether to reinstall automatically so the
 * new interval takes effect immediately. Returns false (rather than
 * exiting) for unsupported platforms — `agent interval` should still
 * succeed on unsupported hosts where the user is supervising manually.
 */
export function isRunnerInstalled() {
  const platform = os.platform();
  try {
    if (platform === "darwin") return fs.existsSync(PLIST_PATH);
    if (platform === "linux") return fs.existsSync(path.join(systemdUserDir(), TIMER_FILE));
  } catch { /* defensive */ }
  return false;
}
