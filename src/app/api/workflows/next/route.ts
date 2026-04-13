import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { getNextWorkflowRun } from "@/lib/db/queries";

export const GET = withAuth(async () => {
  const payload = getNextWorkflowRun();
  if (!payload) return NextResponse.json(null);
  return NextResponse.json(payload);
});
