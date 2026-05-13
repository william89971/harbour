import { NextRequest, NextResponse } from "next/server";
import { withAuth, withOperator } from "@/lib/auth";
import { unlinkDatabaseFromJobAsync } from "@/lib/db/queries";

export const DELETE = withOperator(async (req, auth, { params }) => {
  const { id, dataId } = await params;
  await unlinkDatabaseFromJobAsync(id, dataId);
  return NextResponse.json({ ok: true });
});
