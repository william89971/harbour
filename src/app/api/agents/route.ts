import { NextRequest, NextResponse } from "next/server";
import { withAuth, withUserAuth, withOperator } from "@/lib/auth";
import { listAgentsAsync, createAgentAsync } from "@/lib/db/queries";
import { defaultPermissionMode, isValidPermissionMode, type PermissionMode } from "@/lib/db/agents";
import { saveRunnerConfig } from "@/lib/runners";

export const GET = withAuth(async (req) => {
  const projectId = req.nextUrl.searchParams.get("projectId") || undefined;
  return NextResponse.json(await listAgentsAsync(projectId));
});

export const POST = withOperator(async (req) => {
  const body = await req.json();
  const { name, description, type, cli, model, thinking, remote, eager, maxConcurrentRuns, shellCommand, shellCwd, permissionMode, apiBaseUrl, apiKeyEnv, toolPermissions } = body;
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (type === "harbour") {
    if (!cli) {
      return NextResponse.json({ error: "cli is required for harbour agents" }, { status: 400 });
    }
  }
  if (maxConcurrentRuns !== undefined) {
    const n = Number(maxConcurrentRuns);
    if (!Number.isInteger(n) || n < 1 || n > 10) {
      return NextResponse.json({ error: "maxConcurrentRuns must be an integer between 1 and 10" }, { status: 400 });
    }
  }
  if (cli === "shell" && (!shellCommand || !String(shellCommand).trim())) {
    return NextResponse.json({ error: "shellCommand is required for Custom Shell agents" }, { status: 400 });
  }

  let effectiveMode: PermissionMode | undefined;
  if (permissionMode !== undefined && permissionMode !== null) {
    if (!isValidPermissionMode(permissionMode)) {
      return NextResponse.json({ error: "permissionMode must be one of: safe, custom, unrestricted" }, { status: 400 });
    }
    effectiveMode = permissionMode;
  } else {
    effectiveMode = defaultPermissionMode(cli, type || "external");
  }

  let agent;
  try {
    agent = await createAgentAsync(
      name, description,
      type === "harbour"
        ? { type, cli, model, thinking, remote: !!remote, eager: !!eager, maxConcurrentRuns, shellCommand, shellCwd, permissionMode: effectiveMode, apiBaseUrl, apiKeyEnv, toolPermissions }
        : { maxConcurrentRuns, shellCommand, shellCwd, permissionMode: effectiveMode, toolPermissions },
    );
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  // For harbour agents running on the same machine as the server, save runner
  // config locally so the CLI can poll. Remote agents are expected to be
  // registered from the remote host via `harbour agent connect`.
  if (type === "harbour" && !remote) {
    const baseUrl = req.headers.get("origin") || `http://localhost:${process.env.PORT || 3000}`;
    saveRunnerConfig({
      agentId: agent.id,
      name: agent.name,
      apiKey: agent.apiKey,
      cli: cli,
      model: model || null,
      thinking: thinking || null,
      eager: !!eager,
      maxConcurrentRuns: agent.max_concurrent_runs ?? 1,
      shellCommand: agent.shell_command ?? null,
      shellCwd: agent.shell_cwd ?? null,
      permissionMode: agent.permission_mode,
      apiBaseUrl: agent.api_base_url ?? null,
      apiKeyEnv: agent.api_key_env ?? null,
      url: baseUrl,
    });
  }

  return NextResponse.json(agent, { status: 201 });
});
