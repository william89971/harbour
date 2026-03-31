import { NextRequest, NextResponse } from "next/server";
import { getAuthFromRequest, requireAuth } from "@/lib/auth";
import { getAgentById, updateAgent, deleteAgent } from "@/lib/db/queries";
import { removeRunnerConfig, loadRunners, saveRunnerConfig } from "@/lib/runners";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthFromRequest(req);
  const authError = requireAuth(auth);
  if (authError) return authError;

  const { id } = await params;
  const agent = getAgentById(id);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  return NextResponse.json(agent);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthFromRequest(req);
  const authError = requireAuth(auth);
  if (authError) return authError;

  const { id } = await params;
  const existing = getAgentById(id);
  if (!existing) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const body = await req.json();
  const updated = updateAgent(id, body);

  // Sync runner config if this is a harbour agent and model/name/thinking changed
  if (existing.type === "harbour" && (body.model !== undefined || body.name !== undefined || body.thinking !== undefined)) {
    const runner = loadRunners().find(r => r.agentId === id);
    if (runner) {
      if (body.model !== undefined) runner.model = body.model;
      if (body.name !== undefined) runner.name = body.name;
      if (body.thinking !== undefined) runner.thinking = body.thinking || null;
      saveRunnerConfig(runner);
    }
  }

  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthFromRequest(req);
  const authError = requireAuth(auth);
  if (authError) return authError;
  if (auth!.type !== "user") {
    return NextResponse.json({ error: "Only users can delete agents" }, { status: 403 });
  }

  const { id } = await params;
  const agent = getAgentById(id);
  deleteAgent(id);
  if (agent?.type === "harbour") {
    removeRunnerConfig(id);
  }
  return NextResponse.json({ ok: true });
}
