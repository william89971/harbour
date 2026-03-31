import { NextRequest, NextResponse } from "next/server";
import { getAuthFromRequest, requireAuth } from "@/lib/auth";
import { listEnvVars, createEnvVar } from "@/lib/db/queries";

export async function GET(req: NextRequest) {
  const auth = await getAuthFromRequest(req);
  const authError = requireAuth(auth);
  if (authError) return authError;

  return NextResponse.json(listEnvVars());
}

export async function POST(req: NextRequest) {
  const auth = await getAuthFromRequest(req);
  const authError = requireAuth(auth);
  if (authError) return authError;
  if (auth!.type !== "user") {
    return NextResponse.json({ error: "Only users can create env vars" }, { status: 403 });
  }

  const body = await req.json();
  if (!body.name?.trim() || !body.value?.trim()) {
    return NextResponse.json({ error: "name and value are required" }, { status: 400 });
  }

  const envVar = createEnvVar(body.name.trim(), body.value);
  return NextResponse.json(envVar, { status: 201 });
}
