import { NextRequest, NextResponse } from "next/server";
import { getAuthFromRequest, requireAuth } from "@/lib/auth";
import { getJobById, linkEnvVarToJob } from "@/lib/db/queries";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthFromRequest(req);
  const authError = requireAuth(auth);
  if (authError) return authError;

  const { id } = await params;
  const job = getJobById(id);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const body = await req.json();
  if (!body.envVarId) {
    return NextResponse.json({ error: "envVarId is required" }, { status: 400 });
  }

  linkEnvVarToJob(id, body.envVarId);
  return NextResponse.json({ ok: true });
}
