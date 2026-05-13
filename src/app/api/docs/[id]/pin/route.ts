import { NextRequest, NextResponse } from "next/server";
import { withAuth, withOperator } from "@/lib/auth";
import { getDocByIdAsync, toggleDocPinnedAsync } from "@/lib/db/queries";

export const POST = withOperator(async (req, auth, { params }) => {
  const { id } = await params;
  const doc = await getDocByIdAsync(id);
  if (!doc) return NextResponse.json({ error: "Doc not found" }, { status: 404 });

  const updated = await toggleDocPinnedAsync(id);
  return NextResponse.json(updated);
});
