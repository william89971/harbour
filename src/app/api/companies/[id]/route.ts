import { NextResponse } from "next/server";
import { withAuth, withOperator } from "@/lib/auth";
import {
  getCompanyByIdAsync,
  updateCompanyAsync,
  deleteCompanyAsync,
  COMPANY_STATUSES,
  type CompanyStatus,
} from "@/lib/db/companies";

function isStatus(v: unknown): v is CompanyStatus {
  return typeof v === "string" && (COMPANY_STATUSES as string[]).includes(v);
}

export const GET = withAuth(async (_req, _auth, { params }) => {
  const { id } = await params;
  const c = await getCompanyByIdAsync(id);
  if (!c) return NextResponse.json({ error: "Company not found" }, { status: 404 });
  return NextResponse.json(c);
});

export const PUT = withOperator(async (req, _auth, { params }) => {
  const { id } = await params;
  const existing = await getCompanyByIdAsync(id);
  if (!existing) return NextResponse.json({ error: "Company not found" }, { status: 404 });
  const body = await req.json();
  if (body.status !== undefined && !isStatus(body.status)) {
    return NextResponse.json({ error: `status must be one of ${COMPANY_STATUSES.join(", ")}` }, { status: 400 });
  }
  const updated = await updateCompanyAsync(id, {
    name: body.name,
    website: body.website,
    industry: body.industry,
    status: body.status,
    notes: body.notes,
  });
  return NextResponse.json(updated);
});

export const DELETE = withOperator(async (_req, _auth, { params }) => {
  const { id } = await params;
  await deleteCompanyAsync(id);
  return NextResponse.json({ ok: true });
});
