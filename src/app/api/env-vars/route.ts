import { NextRequest, NextResponse } from "next/server";
import { withAuth, withUserAuth } from "@/lib/auth";
import { listEnvVars, createEnvVar } from "@/lib/db/queries";

export const GET = withAuth(async () => {
  return NextResponse.json(listEnvVars());
});

export const POST = withUserAuth(async (req) => {
  const body = await req.json();
  if (!body.name?.trim() || !body.value?.trim()) {
    return NextResponse.json({ error: "name and value are required" }, { status: 400 });
  }

  const envVar = createEnvVar(body.name.trim(), body.value);
  return NextResponse.json(envVar, { status: 201 });
});
