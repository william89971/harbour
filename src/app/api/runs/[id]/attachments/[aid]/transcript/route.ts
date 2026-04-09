import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { withAuth, requireAgentOwnership } from "@/lib/auth";
import { getRunById, getProcessingByAttachment } from "@/lib/db/queries";
import { uploadsDir } from "@/lib/paths";

export const runtime = "nodejs";

export const GET = withAuth(async (_req, auth, { params }) => {
  const { id, aid } = await params;
  const run = getRunById(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const ownerError = requireAgentOwnership(auth, run.agent_id);
  if (ownerError) return ownerError;

  const processing = getProcessingByAttachment(aid);
  if (!processing || !processing.transcript_path) {
    return NextResponse.json({ error: "No transcript available" }, { status: 404 });
  }

  const abs = path.join(uploadsDir(), processing.transcript_path);
  if (!fs.existsSync(abs)) {
    return NextResponse.json({ error: "Transcript file missing" }, { status: 404 });
  }

  const text = fs.readFileSync(abs, "utf-8");
  return new NextResponse(text, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
});
