import { NextResponse } from "next/server";
import { withOperator } from "@/lib/auth";
import { setSettingAsync } from "@/lib/db/settings";
import { getGitHubPublicConfigAsync, DEFAULT_TOKEN_ENV_VAR_NAME } from "@/lib/github";

const MAX_FIELD_LEN = 200;
const VALID_FIELD = /^[\w.\-\/]+$/;

function validateField(label: string, v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return `${label} must be a string`;
  if (v.length === 0) return null;
  if (v.length > MAX_FIELD_LEN) return `${label} is too long (max ${MAX_FIELD_LEN})`;
  if (!VALID_FIELD.test(v)) return `${label} contains invalid characters (alphanumeric, dash, underscore, dot, slash only)`;
  if (v.includes("..") || v.startsWith("/") || v.startsWith(".")) {
    return `${label} cannot contain path-traversal patterns`;
  }
  return null;
}

export const GET = withOperator(async () => {
  return NextResponse.json(await getGitHubPublicConfigAsync());
});

export const PUT = withOperator(async (req) => {
  let body: { owner?: unknown; repo?: unknown; defaultBranch?: unknown; tokenEnvVarName?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  for (const [label, key] of [
    ["owner", "owner"],
    ["repo", "repo"],
    ["defaultBranch", "defaultBranch"],
    ["tokenEnvVarName", "tokenEnvVarName"],
  ] as const) {
    const err = validateField(label, body[key]);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
  }

  if (typeof body.owner === "string") await setSettingAsync("github_owner", body.owner.trim());
  if (typeof body.repo === "string") await setSettingAsync("github_repo", body.repo.trim());
  if (typeof body.defaultBranch === "string") await setSettingAsync("github_default_branch", body.defaultBranch.trim());
  if (typeof body.tokenEnvVarName === "string") {
    await setSettingAsync("github_token_env_var_name", body.tokenEnvVarName.trim() || DEFAULT_TOKEN_ENV_VAR_NAME);
  }

  return NextResponse.json(await getGitHubPublicConfigAsync());
});
