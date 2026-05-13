import { NextRequest, NextResponse } from "next/server";
import { withAuth, withOperator } from "@/lib/auth";
import { getAgentByIdAsync, listJobsByAgentAsync, createJobAsync } from "@/lib/db/queries";
import { normalizeSchedule } from "@/lib/schedule";

export const GET = withAuth(async (req, auth, { params }) => {
  const { id } = await params;
  const agent = await getAgentByIdAsync(id);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  return NextResponse.json(await listJobsByAgentAsync(id));
});

export const POST = withOperator(async (req, _auth, { params }) => {
  const { id } = await params;
  const agent = await getAgentByIdAsync(id);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const body = await req.json();
  if (!body.name || !body.schedule) {
    return NextResponse.json({ error: "name and schedule are required" }, { status: 400 });
  }
  if (body.teamId) {
    return NextResponse.json({ error: "use /api/teams/:id/jobs to create team-assigned jobs" }, { status: 400 });
  }

  const normalized = normalizeSchedule(body.schedule);
  if (!normalized) {
    return NextResponse.json({ error: "Invalid schedule format. Use {\"every\":N} for intervals or {\"days\":[0-6],\"time\":\"HH:MM\"} for weekly." }, { status: 400 });
  }
  body.schedule = normalized;

  try {
    const job = await createJobAsync(id, body);
    return NextResponse.json(job, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
});
