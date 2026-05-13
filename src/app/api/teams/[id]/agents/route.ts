import { NextResponse } from "next/server";
import { withAuth, withUserAuth, withOperator } from "@/lib/auth";
import { getTeamByIdAsync, listAgentsInTeamAsync, addAgentToTeamAsync } from "@/lib/db/queries";

export const GET = withAuth(async (_req, _auth, { params }) => {
  const { id } = await params;
  if (!(await getTeamByIdAsync(id))) return NextResponse.json({ error: "Team not found" }, { status: 404 });
  return NextResponse.json(await listAgentsInTeamAsync(id));
});

export const POST = withOperator(async (req, _auth, { params }) => {
  const { id } = await params;
  if (!(await getTeamByIdAsync(id))) return NextResponse.json({ error: "Team not found" }, { status: 404 });
  const body = await req.json();
  const agentId = body?.agentId;
  if (!agentId || typeof agentId !== "string") {
    return NextResponse.json({ error: "agentId is required" }, { status: 400 });
  }
  const role = typeof body?.role === "string" ? body.role : "custom";
  const customRole = typeof body?.customRole === "string" ? body.customRole : undefined;
  try {
    await addAgentToTeamAsync(id, agentId, role, customRole);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
});
