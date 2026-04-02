import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { listAllJobs } from "@/lib/db/queries";

export const GET = withAuth(async (req) => {
  const projectId = req.nextUrl.searchParams.get("projectId") || undefined;
  return NextResponse.json(listAllJobs(projectId));
});
