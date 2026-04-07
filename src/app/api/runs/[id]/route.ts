import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { getRunWithActivity, listAttachmentsByRun } from "@/lib/db/queries";
import { serializeAttachment } from "@/lib/attachments-serialize";

export const GET = withAuth(async (req, _auth, { params }) => {
  const { id } = await params;
  const run = getRunWithActivity(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const base = `${req.nextUrl.protocol}//${req.nextUrl.host}`;
  const attachments = listAttachmentsByRun(id).map(a => serializeAttachment(a, base));
  return NextResponse.json({ ...run, attachments });
});
