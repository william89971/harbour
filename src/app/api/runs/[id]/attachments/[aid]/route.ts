import { NextResponse } from "next/server";
import { withAuth, withOperator, requireAgentOwnership } from "@/lib/auth";
import { getRunByIdAsync, getAttachmentByIdAsync, deleteAttachmentAsync } from "@/lib/db/queries";

export const runtime = "nodejs";

export const DELETE = withOperator(async (_req, auth, { params }) => {
  const { id, aid } = await params;
  const run = await getRunByIdAsync(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const ownerError = requireAgentOwnership(auth, run.agent_id);
  if (ownerError) return ownerError;

  const att = await getAttachmentByIdAsync(aid);
  if (!att || att.run_id !== id) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }

  await deleteAttachmentAsync(aid);
  return NextResponse.json({ ok: true });
});
