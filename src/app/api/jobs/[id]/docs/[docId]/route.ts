import { NextRequest, NextResponse } from "next/server";
import { getAuthFromRequest, requireAuth } from "@/lib/auth";
import { unlinkDocFromJob } from "@/lib/db/queries";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const auth = await getAuthFromRequest(req);
  const authError = requireAuth(auth);
  if (authError) return authError;

  const { id, docId } = await params;
  unlinkDocFromJob(id, docId);
  return NextResponse.json({ ok: true });
}
