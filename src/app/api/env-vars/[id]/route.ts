import { NextResponse } from "next/server";
import { withAuth, requireAdmin } from "@/lib/auth";
import { getEnvVarByIdAsync, updateEnvVarAsync, deleteEnvVarAsync } from "@/lib/db/queries";

export const GET = withAuth(async (_req, _auth, { params }) => {
  const { id } = await params;
  const envVar = await getEnvVarByIdAsync(id);
  if (!envVar) return NextResponse.json({ error: "Env var not found" }, { status: 404 });
  return NextResponse.json(envVar);
});

export const PUT = withAuth(async (req, auth, { params }) => {
  const e = requireAdmin(auth); if (e) return e;
  const { id } = await params;
  const existing = await getEnvVarByIdAsync(id);
  if (!existing) return NextResponse.json({ error: "Env var not found" }, { status: 404 });

  const body = await req.json();
  const updated = await updateEnvVarAsync(id, body);
  return NextResponse.json(updated);
});

export const DELETE = withAuth(async (_req, auth, { params }) => {
  const e = requireAdmin(auth); if (e) return e;
  const { id } = await params;
  await deleteEnvVarAsync(id);
  return NextResponse.json({ ok: true });
});
