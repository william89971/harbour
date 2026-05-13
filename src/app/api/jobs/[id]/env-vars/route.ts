import { NextRequest, NextResponse } from "next/server";
import { withAuth, withOperator } from "@/lib/auth";
import { getJobByIdAsync, linkEnvVarToJobAsync } from "@/lib/db/queries";

export const POST = withOperator(async (req, auth, { params }) => {
  const { id } = await params;
  const job = await getJobByIdAsync(id);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const body = await req.json();
  if (!body.envVarId) {
    return NextResponse.json({ error: "envVarId is required" }, { status: 400 });
  }

  await linkEnvVarToJobAsync(id, body.envVarId);
  return NextResponse.json({ ok: true });
});
