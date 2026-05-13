/**
 * Safe-mode default .claude/settings.json for harbour Claude Code agents.
 *
 * Materialized into <workspace>/.claude/settings.json the first time a
 * safe-mode agent runs in a fresh workspace. Once present, the runner
 * doesn't overwrite — so users can extend the deny list. If the file is
 * later deleted or corrupted, a safe-mode run fails loudly rather than
 * silently dropping to unrestricted mode.
 */

import fs from "node:fs";
import path from "node:path";

/** Deny rules Harbour ships by default. Deny wins over allow in Claude
 *  Code, so any user-added allows can't accidentally re-open these. */
export const DEFAULT_SAFE_SETTINGS = {
  permissions: {
    // dontAsk auto-denies anything outside the allow list. Required for -p
    // headless runs (the "default" mode would block waiting for an
    // interactive approval prompt that has no UI).
    defaultMode: "dontAsk",
    deny: [
      "Bash(rm -rf*)",
      "Bash(sudo*)",
      "Bash(chmod*)",
      "Bash(chown*)",
      "Bash(ssh*)",
      "Bash(scp*)",
      // Best-effort: deny curl invocations carrying an Authorization header.
      // Bash patterns match the literal command string, so this is fragile
      // (a hook is the right place for proper URL allow-listing). Still
      // catches the obvious case of `curl -H "Authorization: ..." <url>`.
      "Bash(curl* -H *Authorization*)",
      "Bash(curl* --header *Authorization*)",
      "Read(.env)",
      "Read(.env.*)",
      "Read(**/.env)",
      "Read(**/.env.*)",
      "Read(~/.ssh/**)",
      "Read(~/.harbour/encryption.key)",
      "Read(~/.harbour/runners.json)",
      "Read(~/.harbour/harbour.db)",
      "Read(~/.harbour/harbour.db-*)",
    ],
  },
};

export function settingsPathFor(workspace) {
  return path.join(workspace, ".claude", "settings.json");
}

/**
 * Returns { ok: true } if the workspace has a valid .claude/settings.json
 * (regular file, non-empty, parseable JSON with a top-level `permissions`
 * object); otherwise { ok: false, error } with a human-readable error.
 *
 * Mirrors the detection rules previously inlined in providers.mjs so that
 * runner, API, and the security panel all agree on what "valid" means.
 */
export function validateClaudeSettings(workspace) {
  const settingsPath = settingsPathFor(workspace);
  let stat;
  try {
    stat = fs.lstatSync(settingsPath);
  } catch {
    return { ok: false, error: "settings.json is missing" };
  }
  if (stat.isSymbolicLink()) {
    return { ok: false, error: "settings.json is a symlink" };
  }
  if (!stat.isFile()) {
    return { ok: false, error: "settings.json is not a regular file" };
  }
  if (stat.size === 0) {
    return { ok: false, error: "settings.json is empty" };
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  } catch (err) {
    return { ok: false, error: `settings.json is not valid JSON: ${err.message}` };
  }
  if (!parsed || typeof parsed !== "object" || typeof parsed.permissions !== "object" || parsed.permissions === null) {
    return { ok: false, error: "settings.json is missing a top-level `permissions` object" };
  }
  return { ok: true };
}

/**
 * Idempotent: writes DEFAULT_SAFE_SETTINGS to <workspace>/.claude/settings.json
 * only if the file is missing or invalid. Returns { written: boolean } so the
 * runner can log when it materialized fresh contents.
 */
export function writeSafeSettings(workspace) {
  const dir = path.join(workspace, ".claude");
  const settingsPath = settingsPathFor(workspace);
  const existing = validateClaudeSettings(workspace);
  if (existing.ok) return { written: false };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(DEFAULT_SAFE_SETTINGS, null, 2) + "\n");
  return { written: true };
}
