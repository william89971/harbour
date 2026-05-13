/**
 * Harbour-level safe-mode shim wrappers.
 *
 * For non-Claude CLI providers (Codex, Gemini, Custom Shell) Harbour has
 * no native way to enforce a permission system. As a soft sandbox, we
 * install shim scripts for common dangerous commands into a single shared
 * dir, then prepend that dir to PATH when the agent's permission mode is
 * `safe` or `custom`. The shims exit non-zero with a recognizable message,
 * so the LLM sees the failure and the dashboard can surface it.
 *
 * This is NOT a real sandbox. An LLM that calls `/bin/rm` by absolute
 * path, shells through `python -c`, or sets PATH itself can still escape.
 * The UI and docs are explicit about that limitation.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function harbourHome() {
  return process.env.HARBOUR_HOME || path.join(os.homedir(), ".harbour");
}

/** Shared directory holding the shim scripts. Prepended to PATH in safe mode. */
export function safeShimDir() {
  return path.join(harbourHome(), "safe-shims");
}

/** Commands shimmed by default. Each becomes an executable script that
 *  exits 1 with the harbour-safe-mode message. The list is kept short on
 *  purpose: anything with a legitimate everyday use (curl, git, etc.) is
 *  not shimmed because a denylist that breaks normal work erodes trust
 *  in the whole feature. */
export const DENIED_COMMANDS = [
  "rm",
  "sudo",
  "chmod",
  "chown",
  "ssh",
  "scp",
];

const SHIM_BODY = (cmd) => `#!/usr/bin/env bash
# Harbour safe-mode shim. Generated automatically — do not edit.
echo "harbour-safe-mode: '${cmd}' is denied in safe mode." >&2
echo "harbour-safe-mode: switch the agent to unrestricted mode in the dashboard if this command is truly needed." >&2
exit 1
`;

// Forwards to the real curl unless an Authorization header is detected.
// Recursion is avoided by stripping the shim dir from PATH before exec'ing
// the real binary. PATH parsing is done in pure bash (no external deps,
// works on minimal Linux containers without python3 installed).
const CURL_SHIM_BODY = [
  "#!/usr/bin/env bash",
  "# Harbour safe-mode curl shim. Blocks Authorization headers and config-file",
  "# flags (which can smuggle the same credentials past the argv scanner).",
  "for arg in \"$@\"; do",
  "  case \"$arg\" in",
  "    *Authorization:*)",
  "      echo \"harbour-safe-mode: 'curl' with an Authorization header is denied in safe mode.\" >&2",
  "      echo \"harbour-safe-mode: switch to unrestricted mode if this request truly needs to forward credentials.\" >&2",
  "      exit 1",
  "      ;;",
  "    -K|--config|--config=*)",
  "      echo \"harbour-safe-mode: 'curl -K/--config' (config-file flag) is denied in safe mode.\" >&2",
  "      echo \"harbour-safe-mode: config files can contain Authorization headers that bypass the argv check.\" >&2",
  "      exit 1",
  "      ;;",
  "  esac",
  "done",
  "HARBOUR_SHIM_DIR=\"$(cd \"$(dirname \"$0\")\" && pwd)\"",
  "FILTERED_PATH=\"\"",
  "IFS=':' read -r -a HARBOUR_PATH_PARTS <<< \"${PATH:-/usr/bin:/bin}\"",
  "for p in \"${HARBOUR_PATH_PARTS[@]}\"; do",
  "  if [ \"$p\" != \"$HARBOUR_SHIM_DIR\" ] && [ -n \"$p\" ]; then",
  "    FILTERED_PATH=\"${FILTERED_PATH:+$FILTERED_PATH:}$p\"",
  "  fi",
  "done",
  "PATH=\"$FILTERED_PATH\" exec curl \"$@\"",
  "",
].join("\n");

/** Idempotently install shim scripts into `safeShimDir()`. Safe to call
 *  on every run — fs.writeFileSync is cheap and rewriting the same bytes
 *  has no semantic effect. Returns the dir path for convenience. */
export function installSafeShims() {
  const dir = safeShimDir();
  fs.mkdirSync(dir, { recursive: true });
  for (const cmd of DENIED_COMMANDS) {
    const p = path.join(dir, cmd);
    fs.writeFileSync(p, SHIM_BODY(cmd), { mode: 0o755 });
  }
  fs.writeFileSync(path.join(dir, "curl"), CURL_SHIM_BODY, { mode: 0o755 });
  return dir;
}

/** Build a PATH string for safe-mode spawns. Order matters:
 *
 *   1. safe-shims/     — Harbour denylist (cannot be shadowed)
 *   2. workspace/bin/  — user-installed wrappers
 *   3. original PATH   — fallback to real binaries
 *
 * Shims come first: the workspace bin/ is writable by the running CLI itself
 * (the agent owns its workspace), so a misbehaving CLI in safe mode could
 * otherwise install `bin/rm` and override the denylist. Owners who need to
 * legitimately override should switch the agent to unrestricted mode.
 */
export function safeModePath(workspaceDir, basePath = process.env.PATH || "") {
  const parts = [safeShimDir()];
  try {
    const wbin = path.join(workspaceDir, "bin");
    if (fs.statSync(wbin).isDirectory()) parts.push(wbin);
  } catch { /* no workspace bin/, ignore */ }
  if (basePath) parts.push(basePath);
  return parts.join(":");
}
