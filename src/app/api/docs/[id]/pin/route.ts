import { NextRequest, NextResponse } from "next/server";
import { getAuthFromRequest, requireAuth } from "@/lib/auth";
import { getDocById, toggleDocPinned } from "@/lib/db/queries";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthFromRequest(req);
  const authError = requireAuth(auth);
  if (authError) return authError;

  const { id } = await params;
  const doc = getDocById(id);
  if (!doc) return NextResponse.json({ error: "Doc not found" }, { status: 404 });

  const updated = toggleDocPinned(id);
  return NextResponse.json(updated);
}
