import { NextRequest, NextResponse } from "next/server";
import { getAuthFromRequest, requireAuth } from "@/lib/auth";
import { listAgents, createAgent } from "@/lib/db/queries";
import { saveRunnerConfig } from "@/lib/runners";

export async function GET(req: NextRequest) {
  const auth = await getAuthFromRequest(req);
  const authError = requireAuth(auth);
  if (authError) return authError;

  return NextResponse.json(listAgents());
}

export async function POST(req: NextRequest) {
  const auth = await getAuthFromRequest(req);
  const authError = requireAuth(auth);
  if (authError) return authError;
  if (auth!.type !== "user") {
    return NextResponse.json({ error: "Only users can create agents" }, { status: 403 });
  }

  const body = await req.json();
  const { name, description, type, cli, model } = body;
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (type === "harbour") {
    if (!cli) {
      return NextResponse.json({ error: "cli is required for harbour agents" }, { status: 400 });
    }
  }

  const agent = createAgent(name, description, type === "harbour" ? { type, cli, model } : undefined);

  // For harbour agents, save runner config locally so the CLI can poll
  if (type === "harbour") {
    const baseUrl = req.headers.get("origin") || `http://localhost:${process.env.PORT || 3000}`;
    saveRunnerConfig({
      agentId: agent.id,
      name: agent.name,
      apiKey: agent.apiKey,
      cli: cli,
      model: model || null,
      url: baseUrl,
    });
  }

  return NextResponse.json(agent, { status: 201 });
}
