import { NextRequest, NextResponse } from "next/server";
import { withAuth, withOperator } from "@/lib/auth";
import { unlinkDocFromJobAsync } from "@/lib/db/queries";

export const DELETE = withOperator(async (req, auth, { params }) => {
  const { id, docId } = await params;
  await unlinkDocFromJobAsync(id, docId);
  return NextResponse.json({ ok: true });
});
