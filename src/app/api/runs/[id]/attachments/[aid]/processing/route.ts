import { NextResponse } from "next/server";
import { withAuth, withOperator, requireAgentOwnership } from "@/lib/auth";
import { getRunByIdAsync, getAttachmentByIdAsync, getProcessingByAttachmentAsync } from "@/lib/db/queries";
import { deleteProcessingRecordAsync } from "@/lib/db/video-processing";
import { isVideoFile, processVideoAttachment } from "@/lib/video-processing";

export const runtime = "nodejs";

export const GET = withAuth(async (_req, auth, { params }) => {
  const { id, aid } = await params;
  const run = await getRunByIdAsync(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const ownerError = requireAgentOwnership(auth, run.agent_id);
  if (ownerError) return ownerError;

  const processing = await getProcessingByAttachmentAsync(aid);
  if (!processing) return NextResponse.json({ error: "No processing record" }, { status: 404 });

  return NextResponse.json(processing);
});

export const POST = withOperator(async (_req, auth, { params }) => {
  const { id, aid } = await params;
  const run = await getRunByIdAsync(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const ownerError = requireAgentOwnership(auth, run.agent_id);
  if (ownerError) return ownerError;

  const att = await getAttachmentByIdAsync(aid);
  if (!att || att.run_id !== id) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }

  if (!isVideoFile(att.mime_type, att.filename)) {
    return NextResponse.json({ error: "Attachment is not a video" }, { status: 400 });
  }

  const existing = await getProcessingByAttachmentAsync(aid);
  if (existing) {
    if (existing.status === "queued" || existing.status === "processing") {
      return NextResponse.json({ error: "Already processing" }, { status: 409 });
    }
    // Allow retry of failed/done — delete old record and re-process
    await deleteProcessingRecordAsync(existing.id);
  }

  processVideoAttachment(aid, id);
  return NextResponse.json({ status: "queued" }, { status: 202 });
});
