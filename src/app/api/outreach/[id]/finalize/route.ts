import { NextResponse } from "next/server";
import { withOperator } from "@/lib/auth";
import {
  getOutreachDraftByIdAsync,
  updateOutreachDraftAsync,
} from "@/lib/db/outreach";
import { getApprovalRequestByIdAsync } from "@/lib/db/autonomy";

/**
 * POST /api/outreach/:id/finalize
 * Promotes a `pending_approval` outreach draft to `approved` once its
 * linked approval_request is approved. Idempotent: no-op if already
 * approved or sent.
 */
export const POST = withOperator(async (_req, _auth, { params }) => {
  const { id } = await params;
  const draft = await getOutreachDraftByIdAsync(id);
  if (!draft) return NextResponse.json({ error: "Outreach draft not found" }, { status: 404 });

  if (draft.status === "approved" || draft.status === "sent") {
    return NextResponse.json(draft);
  }
  if (draft.status !== "pending_approval") {
    return NextResponse.json({ error: `draft must be in status 'pending_approval' (current: ${draft.status})` }, { status: 400 });
  }
  if (!draft.approval_request_id) {
    return NextResponse.json({ error: "draft has no linked approval request" }, { status: 400 });
  }

  const approval = await getApprovalRequestByIdAsync(draft.approval_request_id);
  if (!approval) {
    return NextResponse.json({ error: "linked approval request not found" }, { status: 400 });
  }
  if (approval.status === "rejected") {
    return NextResponse.json({ error: "approval was rejected — revert to draft and request again" }, { status: 400 });
  }
  if (approval.status !== "approved") {
    return NextResponse.json({ error: `approval is not yet approved (status: ${approval.status})` }, { status: 400 });
  }

  const updated = await updateOutreachDraftAsync(id, { status: "approved" });
  return NextResponse.json(updated);
});
