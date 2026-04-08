import { NextResponse } from "next/server";
import { withAuth, requireAgentOwnership } from "@/lib/auth";
import { getRunById, getAttachmentById, deleteAttachment } from "@/lib/db/queries";

export const runtime = "nodejs";

export const DELETE = withAuth(async (_req, auth, { params }) => {
  const { id, aid } = await params;
  const run = getRunById(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const ownerError = requireAgentOwnership(auth, run.agent_id);
  if (ownerError) return ownerError;

  const att = getAttachmentById(aid);
  if (!att || att.run_id !== id) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }

  deleteAttachment(aid);
  return NextResponse.json({ ok: true });
});
