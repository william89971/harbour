import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { getNextWorkflowRunAsync } from "@/lib/db/queries";

export const GET = withAuth(async () => {
  const payload = await getNextWorkflowRunAsync();
  if (!payload) return NextResponse.json(null);
  return NextResponse.json(payload);
});
