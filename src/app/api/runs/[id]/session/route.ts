import { NextResponse } from "next/server";
import { withAuth, withOperator, requireAgentOwnership } from "@/lib/auth";
import { getRunByIdAsync, updateRunSessionIdAsync } from "@/lib/db/queries";

export const PUT = withOperator(async (req, auth, { params }) => {
  const { id } = await params;
  const run = await getRunByIdAsync(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const ownerError = requireAgentOwnership(auth, run.agent_id);
  if (ownerError) return ownerError;

  const body = await req.json();
  if (!body.session_id || typeof body.session_id !== "string") {
    return NextResponse.json({ error: "session_id is required" }, { status: 400 });
  }

  await updateRunSessionIdAsync(id, body.session_id, body.cwd || undefined);
  return NextResponse.json({ ok: true });
});
