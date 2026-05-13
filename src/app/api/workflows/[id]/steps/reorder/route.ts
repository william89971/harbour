import { NextResponse } from "next/server";
import { withOperator } from "@/lib/auth";
import { reorderWorkflowStepsAsync } from "@/lib/db/queries";

export const POST = withOperator(async (req, _auth, { params }) => {
  const { id } = await params;
  const body = await req.json() as { stepIds?: string[] };
  if (!Array.isArray(body.stepIds) || body.stepIds.length === 0) {
    return NextResponse.json({ error: "stepIds (array) is required" }, { status: 400 });
  }
  if (!body.stepIds.every(s => typeof s === "string" && s.length > 0)) {
    return NextResponse.json({ error: "stepIds must be a non-empty string array" }, { status: 400 });
  }
  const steps = await reorderWorkflowStepsAsync(id, body.stepIds);
  return NextResponse.json(steps);
});
