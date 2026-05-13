import { NextRequest, NextResponse } from "next/server";
import { withAuth, withOperator } from "@/lib/auth";
import { getJobByIdAsync, linkDocToJobAsync } from "@/lib/db/queries";

export const POST = withOperator(async (req, auth, { params }) => {
  const { id } = await params;
  const job = await getJobByIdAsync(id);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const body = await req.json();
  if (!body.docId) return NextResponse.json({ error: "docId is required" }, { status: 400 });

  await linkDocToJobAsync(id, body.docId);
  return NextResponse.json({ ok: true }, { status: 201 });
});
