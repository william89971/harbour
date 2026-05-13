import { NextResponse } from "next/server";
import { withAuth, withUserAuth, withOperator } from "@/lib/auth";
import { getAgentByIdAsync, updateAgentAsync, deleteAgentAsync } from "@/lib/db/queries";
import { isValidPermissionMode } from "@/lib/db/agents";
import { removeRunnerConfig, loadRunners, saveRunnerConfig } from "@/lib/runners";

export const GET = withAuth(async (_req, _auth, { params }) => {
  const { id } = await params;
  const agent = await getAgentByIdAsync(id);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  return NextResponse.json(agent);
});

export const PUT = withOperator(async (req, _auth, { params }) => {
  const { id } = await params;
  const existing = await getAgentByIdAsync(id);
  if (!existing) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const body = await req.json();

  // Validate max_concurrent_runs at the boundary so users get a clean 400.
  if (body.maxConcurrentRuns !== undefined) {
    const n = Number(body.maxConcurrentRuns);
    if (!Number.isFinite(n) || n < 1 || n > 10 || !Number.isInteger(n)) {
      return NextResponse.json({ error: "maxConcurrentRuns must be an integer between 1 and 10" }, { status: 400 });
    }
  }
  // Custom Shell agents need a non-empty shellCommand.
  const cliAfterUpdate = body.cli !== undefined ? body.cli : existing.cli;
  if (cliAfterUpdate === "shell") {
    const cmdAfterUpdate = body.shellCommand !== undefined ? body.shellCommand : existing.shell_command;
    if (!cmdAfterUpdate || !String(cmdAfterUpdate).trim()) {
      return NextResponse.json({ error: "shellCommand is required for Custom Shell agents" }, { status: 400 });
    }
  }
  if (body.permissionMode !== undefined && body.permissionMode !== null && !isValidPermissionMode(body.permissionMode)) {
    return NextResponse.json({ error: "permissionMode must be one of: safe, custom, unrestricted" }, { status: 400 });
  }

  let updated;
  try {
    updated = await updateAgentAsync(id, body);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  // Sync runner config if this is a harbour agent and any synced field changed
  if (existing.type === "harbour" && (body.model !== undefined || body.name !== undefined || body.thinking !== undefined || body.eager !== undefined || body.maxConcurrentRuns !== undefined || body.shellCommand !== undefined || body.shellCwd !== undefined || body.permissionMode !== undefined || body.apiBaseUrl !== undefined || body.apiKeyEnv !== undefined)) {
    const runner = loadRunners().find(r => r.agentId === id);
    if (runner) {
      if (body.model !== undefined) runner.model = body.model;
      if (body.name !== undefined) runner.name = body.name;
      if (body.thinking !== undefined) runner.thinking = body.thinking || null;
      if (body.eager !== undefined) runner.eager = !!body.eager;
      if (body.maxConcurrentRuns !== undefined) runner.maxConcurrentRuns = Number(body.maxConcurrentRuns);
      if (body.shellCommand !== undefined) runner.shellCommand = body.shellCommand || null;
      if (body.shellCwd !== undefined) runner.shellCwd = body.shellCwd || null;
      if (body.permissionMode !== undefined && updated) runner.permissionMode = updated.permission_mode;
      if (body.apiBaseUrl !== undefined) runner.apiBaseUrl = body.apiBaseUrl || null;
      if (body.apiKeyEnv !== undefined) runner.apiKeyEnv = body.apiKeyEnv || null;
      saveRunnerConfig(runner);
    }
  }

  return NextResponse.json(updated);
});

export const DELETE = withUserAuth(async (req, auth, { params }) => {
  const { id } = await params;
  const agent = await getAgentByIdAsync(id);
  await deleteAgentAsync(id);
  if (agent?.type === "harbour") {
    removeRunnerConfig(id);
  }
  return NextResponse.json({ ok: true });
});
