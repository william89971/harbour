import { NextRequest, NextResponse } from "next/server";
import { getAuthFromRequest, requireAuth } from "@/lib/auth";
import { getDatabaseById, updateRow, deleteRow } from "@/lib/db/queries";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string; rowId: string }> }) {
  const auth = await getAuthFromRequest(req);
  const authError = requireAuth(auth);
  if (authError) return authError;

  const { id, rowId } = await params;
  const db = getDatabaseById(id);
  if (!db) return NextResponse.json({ error: "Database not found" }, { status: 404 });

  const body = await req.json();
  try {
    const row = updateRow(id, parseInt(rowId), body);
    return NextResponse.json(row);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; rowId: string }> }) {
  const auth = await getAuthFromRequest(req);
  const authError = requireAuth(auth);
  if (authError) return authError;

  const { id, rowId } = await params;
  const db = getDatabaseById(id);
  if (!db) return NextResponse.json({ error: "Database not found" }, { status: 404 });

  try {
    deleteRow(id, parseInt(rowId));
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
