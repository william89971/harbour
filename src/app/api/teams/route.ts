import { NextResponse } from "next/server";
import { withAuth, withUserAuth, withOperator } from "@/lib/auth";
import { listTeamsAsync, createTeamAsync } from "@/lib/db/queries";

export const GET = withAuth(async () => {
  return NextResponse.json(await listTeamsAsync());
});

export const POST = withOperator(async (req) => {
  const body = await req.json();
  const { name, description } = body;
  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const team = await createTeamAsync(name.trim(), description ? String(description) : undefined);
  return NextResponse.json(team, { status: 201 });
});
