import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const harbourBin = path.resolve(__dirname, "..", "harbour.mjs");

const PLIST_LABEL = "com.harbour.agent-runner";
const PLIST_PATH = path.join(os.homedir(), "Library", "LaunchAgents", `${PLIST_LABEL}.plist`);
const LOG_PATH = path.join(os.homedir(), ".harbour", "runner.log");
const ERR_LOG_PATH = path.join(os.homedir(), ".harbour", "runner.err.log");

// Resolve node path
let nodePath;
try {
  nodePath = execSync("which node", { encoding: "utf-8" }).trim();
} catch {
  nodePath = process.execPath;
}

function buildPlist() {
  // launchd runs in the user's login session — full keychain & env access
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${harbourBin}</string>
    <string>agent</string>
    <string>run</string>
  </array>
  <key>StartInterval</key>
  <integer>60</integer>
  <key>StandardOutPath</key>
  <string>${LOG_PATH}</string>
  <key>StandardErrorPath</key>
  <string>${ERR_LOG_PATH}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${process.env.PATH || "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"}</string>
    <key>HOME</key>
    <string>${os.homedir()}</string>
  </dict>
</dict>
</plist>`;
}

export function installRunner() {
  if (fs.existsSync(PLIST_PATH)) {
    console.log("Harbour agent runner is already installed.");
    console.log(`To reinstall, run: harbour agent uninstall && harbour agent install`);
    return;
  }

  // Ensure log directory exists
  const logDir = path.dirname(LOG_PATH);
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

  // Write plist
  fs.writeFileSync(PLIST_PATH, buildPlist());

  // Load with launchctl
  try {
    execSync(`launchctl load ${PLIST_PATH}`, { stdio: "inherit" });
  } catch {
    console.error("Failed to load launch agent. Try manually: launchctl load " + PLIST_PATH);
    return;
  }

  console.log("Installed. Harbour agents will be polled every 60 seconds.");
  console.log(`Logs: ~/.harbour/runner.log`);
}

export function uninstallRunner() {
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
