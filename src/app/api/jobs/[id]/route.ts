import { NextRequest, NextResponse } from "next/server";
import { withAuth, withOperator } from "@/lib/auth";
import { getJobByIdAsync, updateJobAsync, deleteJobAsync } from "@/lib/db/queries";
import { normalizeSchedule } from "@/lib/schedule";

export const GET = withAuth(async (req, auth, { params }) => {
  const { id } = await params;
  const job = await getJobByIdAsync(id);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  return NextResponse.json(job);
});

export const PUT = withOperator(async (req, auth, { params }) => {
  const { id } = await params;
  const existing = await getJobByIdAsync(id);
  if (!existing) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const body = await req.json();
  if (body.schedule) {
    const normalized = normalizeSchedule(body.schedule);
    if (!normalized) {
      return NextResponse.json({ error: "Invalid schedule format. Use {\"every\":N} for intervals or {\"days\":[0-6],\"time\":\"HH:MM\"} for weekly." }, { status: 400 });
    }
    body.schedule = normalized;
  }
  if (body.docIds !== undefined && !Array.isArray(body.docIds)) {
    return NextResponse.json({ error: "docIds must be an array of strings" }, { status: 400 });
  }
  if (body.envVarIds !== undefined && !Array.isArray(body.envVarIds)) {
    return NextResponse.json({ error: "envVarIds must be an array of strings" }, { status: 400 });
  }
  try {
    const updated = await updateJobAsync(id, body);
    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
});

export const DELETE = withOperator(async (req, auth, { params }) => {
  const { id } = await params;
  await deleteJobAsync(id);
  return NextResponse.json({ ok: true });
});
