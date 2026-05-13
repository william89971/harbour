import fs from "fs";
import path from "path";
import os from "os";

/**
 * Centralized paths for Harbour's local state.
 *
 * Defaults: everything lives under ~/.harbour so a single backup of that
 * directory captures the DB, uploads, encryption key, and runner config.
 *
 * Overrides:
 *   HARBOUR_HOME           — root dir (default ~/.harbour)
 *   HARBOUR_DB_PATH        — explicit DB file (default <home>/harbour.db)
 *   HARBOUR_UPLOADS_DIR    — explicit uploads dir (default <home>/uploads)
 *   HARBOUR_ENCRYPTION_KEY — encryption key value (otherwise read from <home>/encryption.key)
 *   HARBOUR_MAX_UPLOAD_MB  — per-file upload cap in MB (default 500)
 */

export function harbourHome(): string {
  return process.env.HARBOUR_HOME || path.join(os.homedir(), ".harbour");
}

export function dbPath(): string {
  return process.env.HARBOUR_DB_PATH || path.join(harbourHome(), "harbour.db");
}

export function uploadsDir(): string {
  return process.env.HARBOUR_UPLOADS_DIR || path.join(harbourHome(), "uploads");
}

export function runUploadsDir(runId: string): string {
  return path.join(uploadsDir(), "runs", runId);
}

export function encryptionKeyPath(): string {
  return path.join(harbourHome(), "encryption.key");
}

export function runnersFile(): string {
  return path.join(harbourHome(), "runners.json");
}

export function maxUploadMb(): number {
  const raw = parseInt(process.env.HARBOUR_MAX_UPLOAD_MB || "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 500;
}

export function maxUploadBytes(): number {
  return maxUploadMb() * 1024 * 1024;
}

export function processedDir(runId: string, attachmentId: string): string {
  return path.join(runUploadsDir(runId), "processed", attachmentId);
}

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Slugify an agent name to a workspace directory segment. Must match
 *  bin/lib/providers.mjs::ensureWorkingDir so the server-side security
 *  panel and the runner agree on which directory belongs to which agent. */
export function agentWorkspaceSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

export function agentWorkspaceDir(name: string): string {
  return path.join(harbourHome(), "workspaces", agentWorkspaceSlug(name));
}

export function agentSettingsJsonPath(name: string): string {
  return path.join(agentWorkspaceDir(name), ".claude", "settings.json");
}

/**
 * Resolve a DB-stored attachment path against the uploads root and refuse to
 * escape it. Defense-in-depth: storage_path is set during upload via a
 * sanitized basename + UUID prefix, so escape is not possible from the happy
 * path — but a corrupted DB column, a restore from a different backup, or a
 * future writer bug should not become a wide-open file-read vulnerability.
 * Returns the resolved absolute path on success, throws on traversal.
 */
export function safeUploadJoin(storagePath: string): string {
  if (typeof storagePath !== "string" || !storagePath) {
    throw new Error("invalid storage path");
  }
  // Absolute paths are always a sign of corruption — uploads are stored as
  // relative paths like "runs/<id>/<uuid>__filename". Reject upfront so an
  // absolute /etc/passwd cannot smuggle past path.join (which would happily
  // produce <uploads>/etc/passwd — still under root but clearly wrong).
  if (path.isAbsolute(storagePath)) {
    throw new Error("path traversal blocked");
  }
  const root = path.resolve(uploadsDir());
  const resolved = path.resolve(path.join(root, storagePath));
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error("path traversal blocked");
  }
  return resolved;
}
