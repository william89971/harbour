import { NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth";
import { getApprovalRequestByIdAsync } from "@/lib/db/queries";

export const GET = withUserAuth(async (_req, _auth, { params }) => {
  const { id } = await params;
  const approval = await getApprovalRequestByIdAsync(id);
  if (!approval) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ approval });
});
