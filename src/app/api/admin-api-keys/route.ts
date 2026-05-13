import { NextResponse } from "next/server";
import { withUserAuth, requireAdmin } from "@/lib/auth";
import { listAdminApiKeysAsync, createAdminApiKeyAsync } from "@/lib/db/queries";

export const GET = withUserAuth(async (_req, auth) => {
  const e = requireAdmin(auth); if (e) return e;
  return NextResponse.json(await listAdminApiKeysAsync());
});

export const POST = withUserAuth(async (req, auth) => {
  const e = requireAdmin(auth); if (e) return e;
  const body = await req.json();
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const key = await createAdminApiKeyAsync(body.name.trim(), auth.userId);
  return NextResponse.json(key, { status: 201 });
});
