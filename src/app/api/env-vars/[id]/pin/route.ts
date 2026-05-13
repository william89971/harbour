import { NextResponse } from "next/server";
import { withAuth, requireAdmin } from "@/lib/auth";
import { getEnvVarByIdAsync, toggleEnvVarPinnedAsync } from "@/lib/db/queries";

export const POST = withAuth(async (_req, auth, { params }) => {
  const e = requireAdmin(auth); if (e) return e;
  const { id } = await params;
  const envVar = await getEnvVarByIdAsync(id);
  if (!envVar) return NextResponse.json({ error: "Env var not found" }, { status: 404 });

  const updated = await toggleEnvVarPinnedAsync(id);
  return NextResponse.json(updated);
});
