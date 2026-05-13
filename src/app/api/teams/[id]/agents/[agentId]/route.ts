import { NextResponse } from "next/server";
import { withUserAuth, withOperator } from "@/lib/auth";
import { setAgentRoleInTeamAsync, removeAgentFromTeamAsync } from "@/lib/db/queries";

export const PUT = withOperator(async (req, _auth, { params }) => {
  const { id, agentId } = await params;
  const body = await req.json();
  const role = typeof body?.role === "string" ? body.role : "custom";
  const customRole = typeof body?.customRole === "string" ? body.customRole : undefined;
  try {
    await setAgentRoleInTeamAsync(id, agentId, role, customRole);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
});

export const DELETE = withOperator(async (_req, _auth, { params }) => {
  const { id, agentId } = await params;
  await removeAgentFromTeamAsync(id, agentId);
  return NextResponse.json({ ok: true });
});
