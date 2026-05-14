import { NextResponse } from "next/server";
import { withAuth, withOperator } from "@/lib/auth";
import {
  getOutreachDraftByIdAsync,
  updateOutreachDraftAsync,
  deleteOutreachDraftAsync,
  OUTREACH_STATUSES,
  type OutreachStatus,
} from "@/lib/db/outreach";
import { getApprovalRequestByIdAsync } from "@/lib/db/autonomy";

function isStatus(v: unknown): v is OutreachStatus {
  return typeof v === "string" && (OUTREACH_STATUSES as string[]).includes(v);
}

export const GET = withAuth(async (_req, _auth, { params }) => {
  const { id } = await params;
  const draft = await getOutreachDraftByIdAsync(id);
  if (!draft) return NextResponse.json({ error: "Outreach draft not found" }, { status: 404 });
  const approval = draft.approval_request_id ? await getApprovalRequestByIdAsync(draft.approval_request_id) : null;
  return NextResponse.json({ ...draft, approval });
});

export const PUT = withOperator(async (req, _auth, { params }) => {
  const { id } = await params;
  const existing = await getOutreachDraftByIdAsync(id);
  if (!existing) return NextResponse.json({ error: "Outreach draft not found" }, { status: 404 });
  const body = await req.json();
  if (body.status !== undefined && !isStatus(body.status)) {
    return NextResponse.json({ error: `status must be one of ${OUTREACH_STATUSES.join(", ")}` }, { status: 400 });
  }
  const updated = await updateOutreachDraftAsync(id, {
    subject: body.subject,
    body: body.body,
    contactId: body.contact_id,
    companyId: body.company_id,
    status: body.status,
  });
  return NextResponse.json(updated);
});

export const DELETE = withOperator(async (_req, _auth, { params }) => {
  const { id } = await params;
  await deleteOutreachDraftAsync(id);
  return NextResponse.json({ ok: true });
});
