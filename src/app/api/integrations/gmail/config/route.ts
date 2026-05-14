import { NextResponse } from "next/server";
import { withOperator } from "@/lib/auth";
import { setSettingAsync } from "@/lib/db/settings";
import { getGmailPublicConfigAsync } from "@/lib/gmail";

const MAX_FIELD_LEN = 200;
const NAME_FIELD = /^[A-Za-z_][A-Za-z0-9_]*$/;
const EMAIL_FIELD = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateName(label: string, v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return `${label} must be a string`;
  if (v.length === 0) return null;
  if (v.length > MAX_FIELD_LEN) return `${label} is too long`;
  if (!NAME_FIELD.test(v)) return `${label} must be a valid env-var name (letters, digits, underscore; cannot start with a digit)`;
  return null;
}

function validateEmail(label: string, v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return `${label} must be a string`;
  if (v.length === 0) return null;
  if (v.length > MAX_FIELD_LEN) return `${label} is too long`;
  if (!EMAIL_FIELD.test(v)) return `${label} must look like an email address`;
  return null;
}

export const GET = withOperator(async () => {
  return NextResponse.json(await getGmailPublicConfigAsync());
});

export const PUT = withOperator(async (req) => {
  let body: {
    clientIdEnvVarName?: unknown;
    clientSecretEnvVarName?: unknown;
    refreshTokenEnvVarName?: unknown;
    fromEmail?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const errors = [
    validateName("clientIdEnvVarName", body.clientIdEnvVarName),
    validateName("clientSecretEnvVarName", body.clientSecretEnvVarName),
    validateName("refreshTokenEnvVarName", body.refreshTokenEnvVarName),
    validateEmail("fromEmail", body.fromEmail),
  ].filter(Boolean);
  if (errors.length > 0) {
    return NextResponse.json({ error: errors[0] }, { status: 400 });
  }

  if (typeof body.clientIdEnvVarName === "string") await setSettingAsync("gmail_client_id_env_var_name", body.clientIdEnvVarName.trim());
  if (typeof body.clientSecretEnvVarName === "string") await setSettingAsync("gmail_client_secret_env_var_name", body.clientSecretEnvVarName.trim());
  if (typeof body.refreshTokenEnvVarName === "string") await setSettingAsync("gmail_refresh_token_env_var_name", body.refreshTokenEnvVarName.trim());
  if (typeof body.fromEmail === "string") await setSettingAsync("gmail_from_email", body.fromEmail.trim());

  return NextResponse.json(await getGmailPublicConfigAsync());
});
