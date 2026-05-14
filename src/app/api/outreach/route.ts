import { NextResponse } from "next/server";
import { withAuth, withOperator } from "@/lib/auth";
import {
  listOutreachDraftsAsync,
  createOutreachDraftAsync,
  OUTREACH_STATUSES,
  type OutreachStatus,
} from "@/lib/db/outreach";

function isStatus(v: unknown): v is OutreachStatus {
  return typeof v === "string" && (OUTREACH_STATUSES as string[]).includes(v);
}

export const GET = withAuth(async (req) => {
  const statusParam = req.nextUrl.searchParams.get("status");
  const contactId = req.nextUrl.searchParams.get("contact_id") || undefined;
  let statuses: OutreachStatus[] | undefined;
  if (statusParam) {
    const cs = statusParam.split(",").map(s => s.trim()).filter(Boolean).filter(isStatus);
    statuses = cs.length ? cs : undefined;
  }
  return NextResponse.json(await listOutreachDraftsAsync({ statuses, contactId }));
});

export const POST = withOperator(async (req) => {
  const body = await req.json();
  if (!body.subject || typeof body.subject !== "string") {
    return NextResponse.json({ error: "subject is required" }, { status: 400 });
  }
  if (!body.body || typeof body.body !== "string") {
    return NextResponse.json({ error: "body is required" }, { status: 400 });
  }
  if (body.status !== undefined && !isStatus(body.status)) {
    return NextResponse.json({ error: `status must be one of ${OUTREACH_STATUSES.join(", ")}` }, { status: 400 });
  }
  const draft = await createOutreachDraftAsync({
    subject: body.subject.trim(),
    body: body.body,
    contactId: body.contact_id ?? null,
    companyId: body.company_id ?? null,
    status: body.status,
  });
  return NextResponse.json(draft, { status: 201 });
});
