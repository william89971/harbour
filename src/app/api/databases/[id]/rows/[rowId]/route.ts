import { NextRequest, NextResponse } from "next/server";
import { withAuth, withOperator } from "@/lib/auth";
import { getDatabaseByIdAsync, updateRowAsync, deleteRowAsync } from "@/lib/db/queries";

export const PUT = withOperator(async (req, auth, { params }) => {
  const { id, rowId } = await params;
  const db = await getDatabaseByIdAsync(id);
  if (!db) return NextResponse.json({ error: "Database not found" }, { status: 404 });

  const body = await req.json();
  try {
    const row = await updateRowAsync(id, parseInt(rowId), body);
    return NextResponse.json(row);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
});

export const DELETE = withOperator(async (req, auth, { params }) => {
  const { id, rowId } = await params;
  const db = await getDatabaseByIdAsync(id);
  if (!db) return NextResponse.json({ error: "Database not found" }, { status: 404 });

  try {
    await deleteRowAsync(id, parseInt(rowId));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
});
