import { NextRequest, NextResponse } from "next/server";
import { getAuthFromRequest, requireAuth } from "@/lib/auth";
import { getJobById, linkDatabaseToJob } from "@/lib/db/queries";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthFromRequest(req);
  const authError = requireAuth(auth);
  if (authError) return authError;

  const { id } = await params;
  const job = getJobById(id);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const body = await req.json();
  if (!body.databaseId) return NextResponse.json({ error: "databaseId is required" }, { status: 400 });

  linkDatabaseToJob(id, body.databaseId);
  return NextResponse.json({ ok: true }, { status: 201 });
}
