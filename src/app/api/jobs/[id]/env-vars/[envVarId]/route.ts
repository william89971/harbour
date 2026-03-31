import { NextRequest, NextResponse } from "next/server";
import { getAuthFromRequest, requireAuth } from "@/lib/auth";
import { unlinkEnvVarFromJob } from "@/lib/db/queries";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; envVarId: string }> }) {
  const auth = await getAuthFromRequest(req);
  const authError = requireAuth(auth);
  if (authError) return authError;

  const { id, envVarId } = await params;
  unlinkEnvVarFromJob(id, envVarId);
  return NextResponse.json({ ok: true });
}
