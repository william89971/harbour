import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { getJobById, triggerJobRun } from "@/lib/db/queries";

export const POST = withAuth(async (req, auth, { params }) => {
  const { id } = await params;
  const job = getJobById(id);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const result = triggerJobRun(id);
  if (!result) return NextResponse.json({ error: "Failed to create run" }, { status: 500 });

  return NextResponse.json(result, { status: 201 });
});
