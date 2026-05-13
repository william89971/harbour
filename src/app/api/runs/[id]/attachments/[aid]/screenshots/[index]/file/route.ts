import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { NextResponse } from "next/server";
import { withAuth, requireAgentOwnership } from "@/lib/auth";
import { getRunByIdAsync, getProcessingByAttachmentAsync } from "@/lib/db/queries";
import { safeUploadJoin } from "@/lib/paths";

export const runtime = "nodejs";

export const GET = withAuth(async (_req, auth, { params }) => {
  const { id, aid, index } = await params;
  const run = await getRunByIdAsync(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const ownerError = requireAgentOwnership(auth, run.agent_id);
  if (ownerError) return ownerError;

  const processing = await getProcessingByAttachmentAsync(aid);
  if (!processing || !processing.screenshots_dir) {
    return NextResponse.json({ error: "No screenshots available" }, { status: 404 });
  }

  const idx = parseInt(index, 10);
  if (isNaN(idx) || idx < 0) {
    return NextResponse.json({ error: "Invalid index" }, { status: 400 });
  }

  // Files on disk are 1-based (0001.jpg), API index is 0-based
  const filename = String(idx + 1).padStart(4, "0") + ".jpg";
  let abs: string;
  try {
    abs = safeUploadJoin(path.join(processing.screenshots_dir, filename));
  } catch {
    return NextResponse.json({ error: "Invalid screenshot path" }, { status: 400 });
  }

  if (!fs.existsSync(abs)) {
    return NextResponse.json({ error: "Screenshot not found" }, { status: 404 });
  }

  const stat = fs.statSync(abs);
  const stream = Readable.toWeb(fs.createReadStream(abs)) as unknown as ReadableStream;
  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": stat.size.toString(),
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
});
