import { NextResponse } from "next/server";
import { withOperator } from "@/lib/auth";
import {
  getOutreachDraftByIdAsync,
  updateOutreachDraftAsync,
} from "@/lib/db/outreach";
import { createApprovalRequestAsync } from "@/lib/db/autonomy";

/**
 * POST /api/outreach/:id/request-approval
 * Creates an autonomy approval_request (action_type='contact_customer')
 * pointing back at this outreach draft and flips the draft to
 * `pending_approval`. The operator approves via /approvals.
 */
export const POST = withOperator(async (req, _auth, { params }) => {
  const { id } = await params;
  const draft = await getOutreachDraftByIdAsync(id);
  if (!draft) return NextResponse.json({ error: "Outreach draft not found" }, { status: 404 });
  if (draft.status !== "draft") {
    return NextResponse.json({ error: `draft must be in status 'draft' (current: ${draft.status})` }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const reason = typeof body.reason === "string" && body.reason.trim()
    ? body.reason.trim()
    : `Outreach to ${draft.contact_id ?? "unknown contact"} — subject: ${draft.subject}`;

  const approval = await createApprovalRequestAsync({
    sourceType: "tool_call",
    sourceId: draft.id,
    requestedByAgentId: draft.created_by_agent_id ?? null,
    actionType: "contact_customer",
    riskLevel: "high",
    reason,
    payloadJson: JSON.stringify({
      outreach_draft_id: draft.id,
      contact_id: draft.contact_id,
      company_id: draft.company_id,
      subject: draft.subject,
      body: draft.body,
    }),
  });

  const updated = await updateOutreachDraftAsync(id, {
    status: "pending_approval",
    approvalRequestId: approval.id,
  });
  return NextResponse.json({ ...updated, approval });
});
