import { NextRequest, NextResponse } from "next/server";
import { withAuth, withOperator } from "@/lib/auth";
import { unlinkEnvVarFromJobAsync } from "@/lib/db/queries";

export const DELETE = withOperator(async (req, auth, { params }) => {
  const { id, envVarId } = await params;
  await unlinkEnvVarFromJobAsync(id, envVarId);
  return NextResponse.json({ ok: true });
});
