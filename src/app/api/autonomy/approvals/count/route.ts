import { NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth";
import { countApprovalRequestsAsync } from "@/lib/db/queries";
import { APPROVAL_STATUSES, type ApprovalStatus } from "@/lib/autonomy/constants";

/**
 * GET /api/autonomy/approvals/count?status=pending
 * Cheap COUNT(*) for the sidebar badge. Defaults to `pending`.
 */
export const GET = withUserAuth(async (req) => {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") || "pending";
  const filter: { status?: ApprovalStatus } = {};
  if ((APPROVAL_STATUSES as readonly string[]).includes(status)) {
    filter.status = status as ApprovalStatus;
  }
  const count = await countApprovalRequestsAsync(filter);
  return NextResponse.json({ count });
});
