import fs from "fs";
import { Readable } from "stream";
import { NextResponse } from "next/server";
import { withAuth, requireAgentOwnership } from "@/lib/auth";
import { getRunByIdAsync, getAttachmentByIdAsync } from "@/lib/db/queries";
import { safeUploadJoin } from "@/lib/paths";

export const runtime = "nodejs";

const INLINE_TYPES = [/^image\//, /^video\//, /^audio\//, /^application\/pdf$/];

function isInline(mime: string | null): boolean {
  if (!mime) return false;
  return INLINE_TYPES.some(re => re.test(mime));
}

export const GET = withAuth(async (_req, auth, { params }) => {
  const { id, aid } = await params;
  const run = await getRunByIdAsync(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const ownerError = requireAgentOwnership(auth, run.agent_id);
  if (ownerError) return ownerError;

  const att = await getAttachmentByIdAsync(aid);
  if (!att || att.run_id !== id || att.kind !== "file" || !att.storage_path) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }

  let abs: string;
  try {
    abs = safeUploadJoin(att.storage_path);
  } catch {
    return NextResponse.json({ error: "Invalid storage path" }, { status: 400 });
  }
  if (!fs.existsSync(abs)) {
    return NextResponse.json({ error: "File missing on disk" }, { status: 404 });
  }

  const stat = fs.statSync(abs);
  const mime = att.mime_type || "application/octet-stream";
  const dispositionType = isInline(mime) ? "inline" : "attachment";
  const safeFilename = (att.filename || "file").replace(/"/g, "");

  const stream = Readable.toWeb(fs.createReadStream(abs)) as unknown as ReadableStream;
  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": stat.size.toString(),
      "Content-Disposition": `${dispositionType}; filename="${safeFilename}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
});
