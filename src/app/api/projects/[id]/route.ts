import { NextRequest, NextResponse } from "next/server";
import { withUserAuth, withOperator } from "@/lib/auth";
import {
  getProjectByIdAsync,
  updateProjectAsync,
  deleteProjectAsync,
  linkAgentToProjectAsync,
  unlinkAgentFromProjectAsync,
  linkJobToProjectAsync,
  unlinkJobFromProjectAsync,
  linkDocToProjectAsync,
  unlinkDocFromProjectAsync,
  linkEnvVarToProjectAsync,
  unlinkEnvVarFromProjectAsync,
  linkDatabaseToProjectAsync,
  unlinkDatabaseFromProjectAsync,
} from "@/lib/db/queries";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withUserAuth(async (req: NextRequest, auth, ctx) => {
  const { id } = await (ctx as RouteContext).params;
  const project = await getProjectByIdAsync(id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(project);
});

export const PUT = withOperator(async (req: NextRequest, auth, ctx) => {
  const { id } = await (ctx as RouteContext).params;
  const body = await req.json();
  const project = await updateProjectAsync(id, body);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(project);
});

export const DELETE = withOperator(async (req: NextRequest, auth, ctx) => {
  const { id } = await (ctx as RouteContext).params;
  await deleteProjectAsync(id);
  return NextResponse.json({ ok: true });
});

// PATCH: link/unlink entities to/from this project
export const PATCH = withOperator(async (req: NextRequest, auth, ctx) => {
  const { id } = await (ctx as RouteContext).params;
  const project = await getProjectByIdAsync(id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json();
  const { action, type, targetId } = body as { action: string; type: string; targetId: string };

  if (!action || !type || !targetId) {
    return NextResponse.json({ error: "action, type, and targetId are required" }, { status: 400 });
  }

  const linkers: Record<string, { link: (p: string, t: string) => Promise<unknown>; unlink: (p: string, t: string) => Promise<unknown> }> = {
    agent: { link: linkAgentToProjectAsync, unlink: unlinkAgentFromProjectAsync },
    job: { link: linkJobToProjectAsync, unlink: unlinkJobFromProjectAsync },
    doc: { link: linkDocToProjectAsync, unlink: unlinkDocFromProjectAsync },
    "env-var": { link: linkEnvVarToProjectAsync, unlink: unlinkEnvVarFromProjectAsync },
    database: { link: linkDatabaseToProjectAsync, unlink: unlinkDatabaseFromProjectAsync },
  };

  const linker = linkers[type];
  if (!linker) {
    return NextResponse.json({ error: `invalid type: ${type}` }, { status: 400 });
  }

  if (action === "link") {
    await linker.link(id, targetId);
  } else if (action === "unlink") {
    await linker.unlink(id, targetId);
  } else {
    return NextResponse.json({ error: `invalid action: ${action}` }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
});
