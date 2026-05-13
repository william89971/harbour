import { NextRequest, NextResponse } from "next/server";
import { withAuth, withOperator } from "@/lib/auth";
import { getDatabaseByIdAsync, addColumnAsync } from "@/lib/db/queries";

export const POST = withOperator(async (req, auth, { params }) => {
  const { id } = await params;
  const db = await getDatabaseByIdAsync(id);
  if (!db) return NextResponse.json({ error: "Database not found" }, { status: 404 });

  const body = await req.json();
  if (!body.name || !body.type) {
    return NextResponse.json({ error: "name and type are required" }, { status: 400 });
  }

  try {
    const updated = await addColumnAsync(id, body);
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
});
