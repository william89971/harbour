import { NextResponse } from "next/server";
import { withUserAuth, requireAdmin } from "@/lib/auth";
import { deleteAdminApiKeyAsync } from "@/lib/db/queries";

export const DELETE = withUserAuth(async (_req, auth, { params }) => {
  const e = requireAdmin(auth); if (e) return e;
  const { id } = await params;
  await deleteAdminApiKeyAsync(id);
  return NextResponse.json({ ok: true });
});
