import { NextResponse } from "next/server";
import { withUserAuth } from "@/lib/auth";
import { listApprovalRequestsWithAgentAsync } from "@/lib/db/queries";
import { APPROVAL_STATUSES, APPROVAL_SOURCE_TYPES, type ApprovalSourceType, type ApprovalStatus } from "@/lib/autonomy/constants";

export const GET = withUserAuth(async (req) => {
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const sourceType = url.searchParams.get("source_type");
  const sourceId = url.searchParams.get("source_id");
  const limitParam = url.searchParams.get("limit");

  const filter: {
    status?: ApprovalStatus;
    sourceType?: ApprovalSourceType;
    sourceId?: string;
    limit?: number;
  } = {};
  if (status && (APPROVAL_STATUSES as readonly string[]).includes(status)) filter.status = status as ApprovalStatus;
  if (sourceType && (APPROVAL_SOURCE_TYPES as readonly string[]).includes(sourceType)) filter.sourceType = sourceType as ApprovalSourceType;
  if (sourceId) filter.sourceId = sourceId;
  if (limitParam) {
    const n = parseInt(limitParam, 10);
    if (!Number.isNaN(n) && n > 0) filter.limit = n;
  }
  const approvals = await listApprovalRequestsWithAgentAsync(filter);
  return NextResponse.json({ approvals });
});
