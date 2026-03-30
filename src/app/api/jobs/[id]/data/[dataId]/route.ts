import { NextRequest, NextResponse } from "next/server";
import { getAuthFromRequest, requireAuth } from "@/lib/auth";
import { unlinkDatabaseFromJob } from "@/lib/db/queries";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; dataId: string }> }) {
  const auth = await getAuthFromRequest(req);
  const authError = requireAuth(auth);
  if (authError) return authError;

  const { id, dataId } = await params;
  unlinkDatabaseFromJob(id, dataId);
  return NextResponse.json({ ok: true });
}
