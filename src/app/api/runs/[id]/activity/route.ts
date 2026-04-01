import { NextRequest, NextResponse } from "next/server";
import { withAuth, requireAgentOwnership } from "@/lib/auth";
import { getRunById, addRunActivity, listRunActivity, updateRunStatus } from "@/lib/db/queries";

export const GET = withAuth(async (req, auth, { params }) => {
  const { id } = await params;
  const run = getRunById(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  return NextResponse.json(listRunActivity(id));
});

export const POST = withAuth(async (req, auth, { params }) => {
  const { id } = await params;
  const run = getRunById(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const ownerError = requireAgentOwnership(auth, run.agent_id);
  if (ownerError) return ownerError;

  const body = await req.json();
  if (!body.content) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }

  let authorType: string;
  let authorId: string | null;
  let authorName: string;

  if (auth.type === "user") {
    authorType = "user";
    authorId = auth.userId;
    authorName = auth.displayName;
  } else {
    authorType = "agent";
    authorId = auth.agentId;
    authorName = auth.agentName;
  }

  const entry = addRunActivity(id, authorType, authorId, authorName, body.content);

  // When a user responds, move to pending (ready for agent pickup)
  if (authorType === "user" && ["waiting", "done", "failed"].includes(run.status)) {
    updateRunStatus(id, "pending");
    addRunActivity(id, "system", null, "System", "Status changed to **pending**");
  }

  return NextResponse.json(entry, { status: 201 });
});
