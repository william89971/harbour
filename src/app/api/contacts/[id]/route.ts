import { NextResponse } from "next/server";
import { withAuth, withOperator } from "@/lib/auth";
import {
  getContactByIdAsync,
  updateContactAsync,
  deleteContactAsync,
  CONTACT_STATUSES,
  type ContactStatus,
} from "@/lib/db/contacts";

function isStatus(v: unknown): v is ContactStatus {
  return typeof v === "string" && (CONTACT_STATUSES as string[]).includes(v);
}

export const GET = withAuth(async (_req, _auth, { params }) => {
  const { id } = await params;
  const c = await getContactByIdAsync(id);
  if (!c) return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  return NextResponse.json(c);
});

export const PUT = withOperator(async (req, _auth, { params }) => {
  const { id } = await params;
  const existing = await getContactByIdAsync(id);
  if (!existing) return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  const body = await req.json();
  if (body.status !== undefined && !isStatus(body.status)) {
    return NextResponse.json({ error: `status must be one of ${CONTACT_STATUSES.join(", ")}` }, { status: 400 });
  }
  const updated = await updateContactAsync(id, {
    name: body.name,
    email: body.email,
    companyId: body.company_id,
    title: body.title,
    source: body.source,
    status: body.status,
    notes: body.notes,
  });
  return NextResponse.json(updated);
});

export const DELETE = withOperator(async (_req, _auth, { params }) => {
  const { id } = await params;
  await deleteContactAsync(id);
  return NextResponse.json({ ok: true });
});
