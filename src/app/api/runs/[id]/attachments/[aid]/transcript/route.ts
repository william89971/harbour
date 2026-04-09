import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { withAuth, requireAgentOwnership } from "@/lib/auth";
import { getRunById, getProcessingByAttachment } from "@/lib/db/queries";
import { uploadsDir } from "@/lib/paths";
import { readStoryboard } from "@/lib/video-processing";
import { publicBaseUrl } from "@/lib/request-url";

export const runtime = "nodejs";

export const GET = withAuth(async (req, auth, { params }) => {
  const { id, aid } = await params;
  const run = getRunById(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const ownerError = requireAgentOwnership(auth, run.agent_id);
  if (ownerError) return ownerError;

  const processing = getProcessingByAttachment(aid);
  if (!processing || !processing.transcript_path) {
    return NextResponse.json({ error: "No transcript available" }, { status: 404 });
  }

  // Prefer storyboard (interleaved screenshots + transcript) over plain text
  const format = req.nextUrl.searchParams.get("format");
  if (format !== "plain" && processing.screenshots_dir) {
    const base = publicBaseUrl(req);
    const storyboard = readStoryboard(processing.screenshots_dir, base);
    if (storyboard) {
      return new NextResponse(storyboard, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }
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
