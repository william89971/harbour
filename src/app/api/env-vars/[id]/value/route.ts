import { NextResponse } from "next/server";
import { withUserAuth, requireAdmin } from "@/lib/auth";
import { getEnvVarByIdAsync, getEnvVarDecryptedValueAsync } from "@/lib/db/queries";

export const GET = withUserAuth(async (_req, auth, { params }) => {
  const e = requireAdmin(auth); if (e) return e;
  const { id } = await params;
  const envVar = await getEnvVarByIdAsync(id);
  if (!envVar) return NextResponse.json({ error: "Env var not found" }, { status: 404 });

  const value = await getEnvVarDecryptedValueAsync(id);
  return NextResponse.json({ value });
});
