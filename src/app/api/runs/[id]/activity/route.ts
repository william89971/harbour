import { NextResponse } from "next/server";
import { withAuth, withOperator, requireAgentOwnership } from "@/lib/auth";
import { requireTool } from "@/lib/tool-permissions";
import {
  getRunByIdAsync,
  addRunActivityAsync,
  listRunActivityAsync,
  updateRunStatusAsync,
  linkAttachmentsToActivityAsync,
} from "@/lib/db/queries";

export const GET = withAuth(async (_req, auth, { params }) => {
  const { id } = await params;
  const run = await getRunByIdAsync(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  return NextResponse.json(await listRunActivityAsync(id));
});

export const POST = withOperator(async (req, auth, { params }) => {
  const { id } = await params;
  const run = await getRunByIdAsync(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const ownerError = requireAgentOwnership(auth, run.agent_id as string | null);
  if (ownerError) return ownerError;
  const toolError = requireTool(auth, "post_activity");
  if (toolError) return toolError;

  const body = await req.json() as { content?: string; attachment_ids?: string[] };
  const content = (body.content ?? "").trim();
  const attachmentIds = Array.isArray(body.attachment_ids) ? body.attachment_ids : [];

  // Allow empty content if there are attachments — the attachment is the message
  if (!content && attachmentIds.length === 0) {
    return NextResponse.json({ error: "content or attachment_ids required" }, { status: 400 });
  }

  const authorType = auth.type === "user" ? "user" : "agent";
  const authorId = auth.type === "user" ? auth.userId : auth.agentId;
  const authorName = auth.type === "user" ? auth.displayName : auth.agentName;

  const entry = await addRunActivityAsync(id, authorType, authorId, authorName, content);

  if (attachmentIds.length > 0) {
    await linkAttachmentsToActivityAsync(attachmentIds, entry.id, id);
  }

  // When a user responds, move to pending (ready for agent pickup).
  // 'killed' runs can also be resumed via a comment — the runner saved the
  // session before exiting, so the agent picks back up where it left off.
  if (authorType === "user" && ["waiting", "done", "failed", "killed"].includes(run.status as string)) {
    await updateRunStatusAsync(id, "pending");
    await addRunActivityAsync(id, "system", null, "System", "Status changed to **pending**");
  }

  return NextResponse.json(entry, { status: 201 });
});
