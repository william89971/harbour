import { NextRequest, NextResponse } from "next/server";
import { withAuth, requireAgentOwnership } from "@/lib/auth";
import { getAgentByIdAsync, touchAgentPolledAsync, getAgentNextRunAsync, peekAgentNextAsync, RunAttachment, getProcessingByAttachmentAsync } from "@/lib/db/queries";
import { serializeAttachment, SerializedAttachment } from "@/lib/attachments-serialize";
import { publicBaseUrl } from "@/lib/request-url";
import { isVideoFile, readTranscript, readStoryboard, TRANSCRIPT_CAP } from "@/lib/video-processing";
import type { ToolPermissions } from "@/lib/db/agents";

function buildApiSection(req: NextRequest, runId: string, tp?: ToolPermissions) {
  const base = publicBaseUrl(req);
  // Each endpoint is gated by the agent's tool permissions. The agent
  // sees only those endpoints it may actually use; calls to omitted ones
  // are rejected server-side by requireTool anyway, but filtering here
  // keeps the contract honest for external agents reading the payload.
  const endpoints: Record<string, string> = {
    guide: `GET ${base}/api/guide`,
    upload_attachment: `POST ${base}/api/runs/${runId}/attachments`,
  };
  if (!tp || tp.update_status)   endpoints.update_status  = `PUT ${base}/api/runs/${runId}/status`;
  if (!tp || tp.post_activity)   endpoints.post_activity  = `POST ${base}/api/runs/${runId}/activity`;
  if (!tp || tp.write_docs)      endpoints.create_doc     = `POST ${base}/api/docs`;
  if (!tp || tp.write_docs)      endpoints.update_doc     = `PUT ${base}/api/docs/:id`;
  if (!tp || tp.read_docs)       endpoints.read_doc       = `GET ${base}/api/docs/:id`;
  if (!tp || tp.write_databases) endpoints.create_database = `POST ${base}/api/databases`;
  if (!tp || tp.write_databases) endpoints.insert_rows    = `POST ${base}/api/databases/:id/rows`;
  if (!tp || tp.read_databases)  endpoints.read_rows      = `GET ${base}/api/databases/:id/rows`;
  if (!tp || tp.create_handoffs) endpoints.create_handoff = `POST ${base}/api/runs/${runId}/handoff`;
  return {
    base_url: base,
    endpoints,
    status_options: ["done", "failed", "waiting"],
    tool_permissions: tp || null,
    notes: [
      "You MUST set a final status (done/failed) when finished, or waiting if you need human input.",
      "Post activity messages to log progress — these are visible on the dashboard.",
      "Attachments belong to the run thread — files (multipart) or video URL embeds (JSON {url}).",
      "Endpoints not listed are not permitted for this agent — calls will return 403.",
      "Full API spec available at the guide endpoint.",
    ],
  };
}

export const GET = withAuth(async (req, auth, { params }) => {
  const { id } = await params;
  const ownerError = requireAgentOwnership(auth, id);
  if (ownerError) return ownerError;

  const existing = await getAgentByIdAsync(id);
  if (!existing) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  await touchAgentPolledAsync(id);

  const peek = req.nextUrl.searchParams.get("peek") === "true";
  if (peek) {
    const result = await peekAgentNextAsync(id);
    return NextResponse.json(result);
  }

  const payload = await getAgentNextRunAsync(id);
  if (!payload) {
    return NextResponse.json(null);
  }

  const base = publicBaseUrl(req);
  const serialized = (payload.attachments as RunAttachment[]).map(a => serializeAttachment(a, base));

  // Resolve processing rows in parallel — preserves ordering via Promise.all.
  const enriched = await Promise.all(serialized.map(async (att: SerializedAttachment) => {
    if (!isVideoFile(att.mime_type, att.filename)) return att;
    const proc = await getProcessingByAttachmentAsync(att.id);
    if (!proc) return att;

    const processing: Record<string, unknown> = {
      status: proc.status,
      screenshot_count: proc.screenshot_count,
      screenshots_url: `${base}/api/runs/${payload.run.id}/attachments/${att.id}/screenshots`,
      duration_seconds: proc.duration_seconds,
    };

    if (proc.status === "done") {
      // Prefer storyboard (interleaved screenshots + transcript) over plain transcript
      if (proc.screenshots_dir) {
        const storyboard = readStoryboard(proc.screenshots_dir, base, TRANSCRIPT_CAP);
        if (storyboard) {
          processing.storyboard = storyboard;
        }
      }
      if (proc.transcript_path) {
        processing.transcript = readTranscript(proc.transcript_path, TRANSCRIPT_CAP);
        processing.transcript_url = `${base}/api/runs/${payload.run.id}/attachments/${att.id}/transcript`;
      }
    }

    return { ...att, processing };
  }));

  return NextResponse.json({
    ...payload,
    attachments: enriched,
    api: buildApiSection(req, String(payload.run.id), existing.tool_permissions),
  });
});
