import { NextResponse } from "next/server";
import { withAuth, withOperator } from "@/lib/auth";
import { getTeamByIdAsync, createJobAsync } from "@/lib/db/queries";
import { normalizeSchedule } from "@/lib/schedule";

export const POST = withOperator(async (req, _auth, { params }) => {
  const { id } = await params;
  const team = await getTeamByIdAsync(id);
  if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 });

  const body = await req.json();
  if (!body.name || !body.schedule) {
    return NextResponse.json({ error: "name and schedule are required" }, { status: 400 });
  }

  const normalized = normalizeSchedule(body.schedule);
  if (!normalized) {
    return NextResponse.json({ error: 'Invalid schedule format. Use {"every":N} for intervals or {"days":[0-6],"time":"HH:MM"} for weekly.' }, { status: 400 });
  }
  body.schedule = normalized;
  body.teamId = id;
  // Force agentId to null — team-assigned jobs are not directly owned by an agent
  body.agentId = undefined;

  try {
    const job = await createJobAsync(null, body);
    return NextResponse.json(job, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
});
