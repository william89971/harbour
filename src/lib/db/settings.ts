import { getDb, getDbAsync } from "./schema";

// ---------------------------------------------------------------------------
// Sync API (legacy — SQLite only). Existing callers throughout the codebase
// use these. Switching them all to async happens incrementally; in the
// meantime, sync settings keep working unchanged on SQLite. If the user has
// set DATABASE_URL=postgres://... the sync getDb() throws fast with a clear
// migration message — callers must be on the async API at that point.
// ---------------------------------------------------------------------------

export function getSetting(key: string): string | null {
  const db = getDb();
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value?: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string) {
  const db = getDb();
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

export function getAllSettings(): Record<string, string> {
  const db = getDb();
  const rows = db.prepare(`SELECT key, value FROM settings`).all() as { key: string; value: string }[];
  const result: Record<string, string> = {};
  for (const row of rows) result[row.key] = row.value;
  return result;
}

export function getTimezone(): string {
  return getSetting("timezone") || Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function isSignupEnabled(): boolean {
  const val = getSetting("signup_enabled");
  return val === null || val === "true";
}

export function getRecentRunsLimit(): number {
  const val = getSetting("recent_runs_limit");
  const n = val ? parseInt(val, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 10;
}

export function isVideoAutoProcessEnabled(): boolean {
  return getSetting("video_auto_process") === "true";
}

export function getVideoScreenshotInterval(): number {
  const val = getSetting("video_screenshot_interval");
  const n = val ? parseInt(val, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 5;
}

export type TranscriptProvider = "off" | "whisper" | "openai" | "gemini";

export function getVideoTranscriptProvider(): TranscriptProvider {
  const val = getSetting("video_transcript_provider");
  if (val === "whisper" || val === "openai" || val === "gemini") return val;
  return "off";
}

export function getVideoTranscriptApiKey(provider: "openai" | "gemini"): string | null {
  const key = provider === "openai" ? "video_openai_api_key" : "video_gemini_api_key";
  return getSetting(key);
}

// ---------------------------------------------------------------------------
// Async API (cross-backend — SQLite and Postgres). Use these from new code
// and when migrating existing call sites off the sync API.
// ---------------------------------------------------------------------------

export async function getSettingAsync(key: string): Promise<string | null> {
  const db = await getDbAsync();
  const row = await db.get<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, [key]);
  return row?.value ?? null;
}

export async function setSettingAsync(key: string, value: string): Promise<void> {
  const db = await getDbAsync();
  await db.run(
    `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

export async function getAllSettingsAsync(): Promise<Record<string, string>> {
  const db = await getDbAsync();
  const rows = await db.all<{ key: string; value: string }>(`SELECT key, value FROM settings`);
  const result: Record<string, string> = {};
  for (const row of rows) result[row.key] = row.value;
  return result;
}

export async function getTimezoneAsync(): Promise<string> {
  return (await getSettingAsync("timezone")) || Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export async function isSignupEnabledAsync(): Promise<boolean> {
  const val = await getSettingAsync("signup_enabled");
  return val === null || val === "true";
}

export async function getRecentRunsLimitAsync(): Promise<number> {
  const val = await getSettingAsync("recent_runs_limit");
  const n = val ? parseInt(val, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 10;
}

export async function isVideoAutoProcessEnabledAsync(): Promise<boolean> {
  return (await getSettingAsync("video_auto_process")) === "true";
}

export async function getVideoScreenshotIntervalAsync(): Promise<number> {
  const val = await getSettingAsync("video_screenshot_interval");
  const n = val ? parseInt(val, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 5;
}

export async function getVideoTranscriptProviderAsync(): Promise<TranscriptProvider> {
  const val = await getSettingAsync("video_transcript_provider");
  if (val === "whisper" || val === "openai" || val === "gemini") return val;
  return "off";
}

export async function getVideoTranscriptApiKeyAsync(provider: "openai" | "gemini"): Promise<string | null> {
  const key = provider === "openai" ? "video_openai_api_key" : "video_gemini_api_key";
  return getSettingAsync(key);
}

// ---------------------------------------------------------------------------
// Sensitive-value masking (pure helpers — no DB access)
// ---------------------------------------------------------------------------

const SENSITIVE_SETTINGS = new Set(["video_openai_api_key", "video_gemini_api_key"]);

export function isSensitiveSetting(key: string): boolean {
  return SENSITIVE_SETTINGS.has(key);
}

export function maskSettingValue(value: string): string {
  if (value.length <= 8) return "••••••••";
  return "••••••••" + value.slice(-4);
}
