import { NextResponse } from "next/server";
import { withAuth, withOperator } from "@/lib/auth";
import { listWorkflowsAsync, createWorkflowAsync } from "@/lib/db/queries";

const VALID_STATUS = ["draft", "active", "paused", "archived"] as const;
const VALID_AUTONOMY = ["manual", "supervised", "autonomous"] as const;
const MAX_NAME_LEN = 200;
const MAX_DESCRIPTION_LEN = 5000;
const MAX_DEPARTMENT_LEN = 100;

export const GET = withAuth(async () => {
  return NextResponse.json(await listWorkflowsAsync());
});

export const POST = withOperator(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const name = body.name.trim();
  if (name.length > MAX_NAME_LEN) {
    return NextResponse.json({ error: `name too long (max ${MAX_NAME_LEN} chars)` }, { status: 400 });
  }
  if (body.description != null && typeof body.description !== "string") {
    return NextResponse.json({ error: "description must be a string" }, { status: 400 });
  }
  if (typeof body.description === "string" && body.description.length > MAX_DESCRIPTION_LEN) {
    return NextResponse.json({ error: `description too long (max ${MAX_DESCRIPTION_LEN} chars)` }, { status: 400 });
  }
  if (body.department != null && typeof body.department !== "string") {
    return NextResponse.json({ error: "department must be a string" }, { status: 400 });
  }
  if (typeof body.department === "string" && body.department.length > MAX_DEPARTMENT_LEN) {
    return NextResponse.json({ error: `department too long (max ${MAX_DEPARTMENT_LEN} chars)` }, { status: 400 });
  }
  if (body.status != null && !VALID_STATUS.includes(body.status)) {
    return NextResponse.json({ error: `invalid status: must be one of ${VALID_STATUS.join(", ")}` }, { status: 400 });
  }
  if (body.autonomyLevel != null && !VALID_AUTONOMY.includes(body.autonomyLevel)) {
    return NextResponse.json({ error: `invalid autonomyLevel: must be one of ${VALID_AUTONOMY.join(", ")}` }, { status: 400 });
  }
  try {
    const workflow = await createWorkflowAsync({
      name,
      description: body.description ?? null,
      department: body.department ?? null,
      status: body.status,
      autonomyLevel: body.autonomyLevel,
    });
    return NextResponse.json(workflow, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
});
