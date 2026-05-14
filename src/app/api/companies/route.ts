import { NextResponse } from "next/server";
import { withAuth, withOperator } from "@/lib/auth";
import {
  listCompaniesAsync,
  createCompanyAsync,
  COMPANY_STATUSES,
  type CompanyStatus,
} from "@/lib/db/companies";

function isStatus(v: unknown): v is CompanyStatus {
  return typeof v === "string" && (COMPANY_STATUSES as string[]).includes(v);
}

export const GET = withAuth(async (req) => {
  const statusParam = req.nextUrl.searchParams.get("status");
  const status = isStatus(statusParam) ? statusParam : undefined;
  return NextResponse.json(await listCompaniesAsync(status));
});

export const POST = withOperator(async (req) => {
  const body = await req.json();
  if (!body.name || typeof body.name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (body.status !== undefined && !isStatus(body.status)) {
    return NextResponse.json({ error: `status must be one of ${COMPANY_STATUSES.join(", ")}` }, { status: 400 });
  }
  const company = await createCompanyAsync({
    name: body.name,
    website: body.website ?? null,
    industry: body.industry ?? null,
    status: body.status,
    notes: body.notes ?? null,
  });
  return NextResponse.json(company, { status: 201 });
});
