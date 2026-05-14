/**
 * Gmail integration — read-only-ish client (creates drafts, never sends).
 *
 * Configuration:
 *   - settings: gmail_client_id_env_var_name, gmail_client_secret_env_var_name,
 *     gmail_refresh_token_env_var_name, gmail_from_email.
 *   - secrets: stored in env_vars (encrypted via the existing pattern).
 *
 * Auth: OAuth 2.0 refresh-token flow. We exchange refresh_token → access_token
 * on every API call (cheap, ~200ms; no caching to keep state simple).
 *
 * Scope required: https://www.googleapis.com/auth/gmail.modify
 */

import { getSettingAsync } from "./db/settings";
import {
  getDecryptedEnvVarValueByNameAsync,
  getEnvVarByNameAsync,
} from "./db/env-vars";

export const DEFAULT_CLIENT_ID_ENV_VAR = "GMAIL_CLIENT_ID";
export const DEFAULT_CLIENT_SECRET_ENV_VAR = "GMAIL_CLIENT_SECRET";
export const DEFAULT_REFRESH_TOKEN_ENV_VAR = "GMAIL_REFRESH_TOKEN";

export type GmailConfig = {
  clientIdEnvVarName: string;
  clientSecretEnvVarName: string;
  refreshTokenEnvVarName: string;
  fromEmail: string;
  clientId: string | null;
  clientSecret: string | null;
  refreshToken: string | null;
};

export type GmailPublicConfig = {
  clientIdEnvVarName: string;
  clientSecretEnvVarName: string;
  refreshTokenEnvVarName: string;
  fromEmail: string;
  configured: boolean;
  tokenConfigured: boolean;
};

export type GmailDraftResult = {
  id: string;
  messageId: string | null;
  threadId: string | null;
  draftsUrl: string;
};

const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_DRAFTS_URL = "https://gmail.googleapis.com/gmail/v1/users/me/drafts";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export async function getGmailConfigAsync(): Promise<GmailConfig> {
  const [clientIdName, clientSecretName, refreshTokenName, fromEmail] = await Promise.all([
    getSettingAsync("gmail_client_id_env_var_name"),
    getSettingAsync("gmail_client_secret_env_var_name"),
    getSettingAsync("gmail_refresh_token_env_var_name"),
    getSettingAsync("gmail_from_email"),
  ]);
  const cfg: GmailConfig = {
    clientIdEnvVarName: clientIdName || DEFAULT_CLIENT_ID_ENV_VAR,
    clientSecretEnvVarName: clientSecretName || DEFAULT_CLIENT_SECRET_ENV_VAR,
    refreshTokenEnvVarName: refreshTokenName || DEFAULT_REFRESH_TOKEN_ENV_VAR,
    fromEmail: fromEmail || "",
    clientId: null,
    clientSecret: null,
    refreshToken: null,
  };
  const [clientId, clientSecret, refreshToken] = await Promise.all([
    getDecryptedEnvVarValueByNameAsync(cfg.clientIdEnvVarName),
    getDecryptedEnvVarValueByNameAsync(cfg.clientSecretEnvVarName),
    getDecryptedEnvVarValueByNameAsync(cfg.refreshTokenEnvVarName),
  ]);
  cfg.clientId = clientId || null;
  cfg.clientSecret = clientSecret || null;
  cfg.refreshToken = refreshToken || null;
  return cfg;
}

export async function getGmailPublicConfigAsync(): Promise<GmailPublicConfig> {
  const [clientIdName, clientSecretName, refreshTokenName, fromEmail] = await Promise.all([
    getSettingAsync("gmail_client_id_env_var_name"),
    getSettingAsync("gmail_client_secret_env_var_name"),
    getSettingAsync("gmail_refresh_token_env_var_name"),
    getSettingAsync("gmail_from_email"),
  ]);
  const cidName = clientIdName || DEFAULT_CLIENT_ID_ENV_VAR;
  const csName = clientSecretName || DEFAULT_CLIENT_SECRET_ENV_VAR;
  const rtName = refreshTokenName || DEFAULT_REFRESH_TOKEN_ENV_VAR;
  const [cidRow, csRow, rtRow] = await Promise.all([
    getEnvVarByNameAsync(cidName),
    getEnvVarByNameAsync(csName),
    getEnvVarByNameAsync(rtName),
  ]);
  const tokenConfigured = !!(cidRow && csRow && rtRow);
  return {
    clientIdEnvVarName: cidName,
    clientSecretEnvVarName: csName,
    refreshTokenEnvVarName: rtName,
    fromEmail: fromEmail || "",
    configured: tokenConfigured && !!fromEmail,
    tokenConfigured,
  };
}

export function isGmailConfigured(cfg: GmailConfig): boolean {
  return !!(cfg.clientId && cfg.clientSecret && cfg.refreshToken && cfg.fromEmail);
}

// ---------------------------------------------------------------------------
// OAuth token exchange
// ---------------------------------------------------------------------------

export async function exchangeRefreshToken(cfg: GmailConfig): Promise<string> {
  if (!cfg.clientId || !cfg.clientSecret || !cfg.refreshToken) {
    throw new Error("Gmail config incomplete: missing client_id, client_secret, or refresh_token");
  }
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: cfg.refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OAuth token exchange failed: HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ""}`);
  }
  const json = await res.json() as { access_token?: string; error?: string; error_description?: string };
  if (!json.access_token) {
    throw new Error(`OAuth response missing access_token${json.error ? `: ${json.error}` : ""}`);
  }
  return json.access_token;
}

// ---------------------------------------------------------------------------
// Test connection
// ---------------------------------------------------------------------------

export async function testGmailConnection(cfg: GmailConfig): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isGmailConfigured(cfg)) {
    return { ok: false, error: "Gmail is not fully configured (need client id/secret/refresh token + from email)." };
  }
  try {
    await exchangeRefreshToken(cfg);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Create draft
// ---------------------------------------------------------------------------

/** Base64url encode a UTF-8 string (Buffer-based; no new deps). */
function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Builds a minimal RFC 2822 message body. */
export function buildRfc2822(fromEmail: string, to: string, subject: string, body: string): string {
  // Encode subject with MIME if it has non-ASCII chars.
  const needsEncode = /[^\x20-\x7E]/.test(subject);
  const subjectHeader = needsEncode
    ? `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`
    : subject;
  return [
    `From: ${fromEmail}`,
    `To: ${to}`,
    `Subject: ${subjectHeader}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
  ].join("\r\n");
}

export async function createGmailDraft(
  cfg: GmailConfig,
  args: { to: string; subject: string; body: string },
): Promise<GmailDraftResult> {
  if (!isGmailConfigured(cfg)) {
    throw new Error("Gmail is not configured.");
  }
  if (!args.to || !args.to.includes("@")) {
    throw new Error("Recipient (to) must be a valid email address.");
  }

  const accessToken = await exchangeRefreshToken(cfg);
  const rfc2822 = buildRfc2822(cfg.fromEmail, args.to, args.subject, args.body);
  const raw = base64UrlEncode(rfc2822);

  const res = await fetch(GMAIL_DRAFTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message: { raw } }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gmail drafts.create failed: HTTP ${res.status}${text ? ` — ${text.slice(0, 300)}` : ""}`);
  }
  const json = await res.json() as {
    id: string;
    message?: { id?: string; threadId?: string };
  };
  return {
    id: json.id,
    messageId: json.message?.id ?? null,
    threadId: json.message?.threadId ?? null,
    draftsUrl: "https://mail.google.com/mail/u/0/#drafts",
  };
}
