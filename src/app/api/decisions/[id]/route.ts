import { NextResponse } from "next/server";
import { withAuth, withOperator } from "@/lib/auth";
import { getDecisionByIdAsync, updateDecisionAsync, deleteDecisionAsync } from "@/lib/db/decisions";

export const GET = withAuth(async (_req, _auth, { params }) => {
  const { id } = await params;
  const decision = await getDecisionByIdAsync(id);
  if (!decision) return NextResponse.json({ error: "Decision not found" }, { status: 404 });
  return NextResponse.json(decision);
});

export const PUT = withOperator(async (req, _auth, { params }) => {
  const { id } = await params;
  const existing = await getDecisionByIdAsync(id);
  if (!existing) return NextResponse.json({ error: "Decision not found" }, { status: 404 });
  const body = await req.json();
  const updated = await updateDecisionAsync(id, {
    title: body.title,
    decision: body.decision,
    rationale: body.rationale,
    consequences: body.consequences,
  });
  return NextResponse.json(updated);
});

export const DELETE = withOperator(async (_req, _auth, { params }) => {
  const { id } = await params;
  await deleteDecisionAsync(id);
  return NextResponse.json({ ok: true });
});
