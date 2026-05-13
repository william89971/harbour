import { NextResponse } from "next/server";
import { withAuth, withUserAuth, withOperator } from "@/lib/auth";
import { getTeamByIdAsync, updateTeamAsync, deleteTeamAsync, listAgentsInTeamAsync } from "@/lib/db/queries";

export const GET = withAuth(async (_req, _auth, { params }) => {
  const { id } = await params;
  const team = await getTeamByIdAsync(id);
  if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 });
  const members = await listAgentsInTeamAsync(id);
  return NextResponse.json({ ...team, members });
});

export const PUT = withOperator(async (req, _auth, { params }) => {
  const { id } = await params;
  const team = await getTeamByIdAsync(id);
  if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 });
  const body = await req.json();
  const updated = await updateTeamAsync(id, {
    name: typeof body?.name === "string" ? body.name : undefined,
    description: body?.description !== undefined ? (body.description === null ? "" : String(body.description)) : undefined,
  });
  return NextResponse.json(updated);
});

export const DELETE = withOperator(async (_req, _auth, { params }) => {
  const { id } = await params;
  await deleteTeamAsync(id);
  return NextResponse.json({ ok: true });
});
