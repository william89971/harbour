import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { listAllJobs } from "@/lib/db/queries";

export const GET = withAuth(async () => {
  return NextResponse.json(listAllJobs());
});
