import { NextRequest, NextResponse } from "next/server";
import { getAuthFromRequest, requireAuth } from "@/lib/auth";
import { getEnvVarById, getEnvVarDecryptedValue } from "@/lib/db/queries";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthFromRequest(req);
  const authError = requireAuth(auth);
  if (authError) return authError;
  if (auth!.type !== "user") {
    return NextResponse.json({ error: "Only users can view env var values" }, { status: 403 });
  }

  const { id } = await params;
  const envVar = getEnvVarById(id);
  if (!envVar) return NextResponse.json({ error: "Env var not found" }, { status: 404 });

  const value = getEnvVarDecryptedValue(id);
  return NextResponse.json({ value });
}
