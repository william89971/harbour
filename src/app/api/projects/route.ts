import { NextRequest, NextResponse } from "next/server";
import { withUserAuth, withOperator } from "@/lib/auth";
import { listProjectsAsync, createProjectAsync } from "@/lib/db/queries";

export const GET = withUserAuth(async () => {
  return NextResponse.json(await listProjectsAsync());
});

export const POST = withOperator(async (req) => {
  const body = await req.json();
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const project = await createProjectAsync(body.name.trim());
  return NextResponse.json(project, { status: 201 });
});
