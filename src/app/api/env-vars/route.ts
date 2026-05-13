import { NextResponse } from "next/server";
import { withAuth, withUserAuth, requireAdmin } from "@/lib/auth";
import { listEnvVarsAsync, createEnvVarAsync } from "@/lib/db/queries";

export const GET = withAuth(async (req) => {
  // Listing returns names only (no plaintext), so read access is fine.
  const projectId = req.nextUrl.searchParams.get("projectId") || undefined;
  return NextResponse.json(await listEnvVarsAsync(projectId));
});

export const POST = withUserAuth(async (req, auth) => {
  const e = requireAdmin(auth); if (e) return e;
  const body = await req.json();
  if (!body.name?.trim() || !body.value?.trim()) {
    return NextResponse.json({ error: "name and value are required" }, { status: 400 });
  }

  const envVar = await createEnvVarAsync(body.name.trim(), body.value);
  return NextResponse.json(envVar, { status: 201 });
});
