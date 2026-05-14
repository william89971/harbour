import { NextResponse } from "next/server";
import { withAuth, withOperator } from "@/lib/auth";
import { listDecisionsAsync, createDecisionAsync } from "@/lib/db/decisions";

export const GET = withAuth(async (req) => {
  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.max(1, Math.min(parseInt(limitParam, 10) || 0, 500)) : undefined;
  return NextResponse.json(await listDecisionsAsync(limit));
});

export const POST = withOperator(async (req) => {
  const body = await req.json();
  if (!body.title || typeof body.title !== "string") {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (!body.decision || typeof body.decision !== "string") {
    return NextResponse.json({ error: "decision is required" }, { status: 400 });
  }
  const decision = await createDecisionAsync({
    title: body.title,
    decision: body.decision,
    rationale: body.rationale ?? null,
    consequences: body.consequences ?? null,
  });
  return NextResponse.json(decision, { status: 201 });
});
