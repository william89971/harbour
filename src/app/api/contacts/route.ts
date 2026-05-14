import { NextResponse } from "next/server";
import { withAuth, withOperator } from "@/lib/auth";
import {
  listContactsAsync,
  createContactAsync,
  CONTACT_STATUSES,
  type ContactStatus,
} from "@/lib/db/contacts";

function isStatus(v: unknown): v is ContactStatus {
  return typeof v === "string" && (CONTACT_STATUSES as string[]).includes(v);
}

export const GET = withAuth(async (req) => {
  const statusParam = req.nextUrl.searchParams.get("status");
  const companyId = req.nextUrl.searchParams.get("company_id") || undefined;
  let statuses: ContactStatus[] | undefined;
  if (statusParam) {
    const cs = statusParam.split(",").map(s => s.trim()).filter(Boolean).filter(isStatus);
    statuses = cs.length ? cs : undefined;
  }
  return NextResponse.json(await listContactsAsync({ statuses, companyId }));
});

export const POST = withOperator(async (req) => {
  const body = await req.json();
  if (!body.name || typeof body.name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (body.status !== undefined && !isStatus(body.status)) {
    return NextResponse.json({ error: `status must be one of ${CONTACT_STATUSES.join(", ")}` }, { status: 400 });
  }
  const contact = await createContactAsync({
    name: body.name,
    email: body.email ?? null,
    companyId: body.company_id ?? null,
    title: body.title ?? null,
    source: body.source ?? null,
    status: body.status,
    notes: body.notes ?? null,
  });
  return NextResponse.json(contact, { status: 201 });
});
