import { NextResponse } from "next/server";
import { withAuth, withUserAuth } from "@/lib/auth";
import { getRunWithActivityAsync, getRunByIdAsync, deleteRunAsync, listAttachmentsByRunAsync } from "@/lib/db/queries";
import { serializeAttachment } from "@/lib/attachments-serialize";
import { publicBaseUrl } from "@/lib/request-url";

export const GET = withAuth(async (req, _auth, { params }) => {
  const { id } = await params;
  const run = await getRunWithActivityAsync(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const base = publicBaseUrl(req);
  const attachmentRows = await listAttachmentsByRunAsync(id);
  const attachments = attachmentRows.map(a => serializeAttachment(a, base));
  return NextResponse.json({ ...run, attachments });
});

export const DELETE = withUserAuth(async (_req, _auth, { params }) => {
  const { id } = await params;
  const run = await getRunByIdAsync(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  await deleteRunAsync(id);
  return NextResponse.json({ success: true });
});
