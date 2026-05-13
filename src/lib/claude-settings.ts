import fs from "fs";

/** Server-side mirror of bin/lib/safe-settings.mjs::validateClaudeSettings.
 *  Used by the agent settings API + security-status endpoint. Kept in sync
 *  by hand — the runner has its own copy in plain JS to avoid pulling the
 *  TS toolchain into the CLI binary. */
export function validateClaudeSettingsPath(settingsPath: string): { ok: true } | { ok: false; error: string } {
  let stat;
  try {
    stat = fs.lstatSync(settingsPath);
  } catch {
    return { ok: false, error: "settings.json is missing" };
  }
  if (stat.isSymbolicLink()) return { ok: false, error: "settings.json is a symlink" };
  if (!stat.isFile()) return { ok: false, error: "settings.json is not a regular file" };
  if (stat.size === 0) return { ok: false, error: "settings.json is empty" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  } catch (err) {
    return { ok: false, error: `settings.json is not valid JSON: ${(err as Error).message}` };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, error: "settings.json must be a JSON object" };
  }
  const obj = parsed as Record<string, unknown>;
  if (!obj.permissions || typeof obj.permissions !== "object") {
    return { ok: false, error: "settings.json is missing a top-level `permissions` object" };
  }
  return { ok: true };
}
