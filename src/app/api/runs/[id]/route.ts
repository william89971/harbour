import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { getRunWithActivity } from "@/lib/db/queries";

export const GET = withAuth(async (req, auth, { params }) => {
  const { id } = await params;
  const run = getRunWithActivity(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  return NextResponse.json(run);
});
