import { NextResponse } from "next/server";
import { withAuth, withOperator, requireAgentOwnership } from "@/lib/auth";
import { getRunByIdAsync } from "@/lib/db/queries";
import { recordRunCostAsync, getRunCostAsync } from "@/lib/db/costs";

export const GET = withAuth(async (_req, _auth, { params }) => {
  const { id } = await params;
  const cost = await getRunCostAsync(id);
  if (!cost) return NextResponse.json({ error: "Cost not found" }, { status: 404 });
  return NextResponse.json(cost);
});

export const POST = withOperator(async (req, auth, { params }) => {
  const { id } = await params;
  const run = await getRunByIdAsync(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const ownerError = requireAgentOwnership(auth, run.agent_id);
  if (ownerError) return ownerError;

  const body = await req.json();
  const provider = typeof body?.provider === "string" ? body.provider : null;
  const model = typeof body?.model === "string" ? body.model : null;
  const inputTokens = Number.isFinite(body?.input_tokens) ? Number(body.input_tokens) : 0;
  const outputTokens = Number.isFinite(body?.output_tokens) ? Number(body.output_tokens) : 0;

  if (inputTokens <= 0 && outputTokens <= 0) {
    return NextResponse.json({ error: "input_tokens or output_tokens required" }, { status: 400 });
  }

  const cost = await recordRunCostAsync(id, {
    provider,
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
  });

  return NextResponse.json(cost);
});
