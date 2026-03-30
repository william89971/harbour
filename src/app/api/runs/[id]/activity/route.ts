import { NextRequest, NextResponse } from "next/server";
import { getAuthFromRequest, requireAuth } from "@/lib/auth";
import { getRunById, addRunActivity, listRunActivity, updateRunStatus } from "@/lib/db/queries";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthFromRequest(req);
  const authError = requireAuth(auth);
  if (authError) return authError;

  const { id } = await params;
  const run = getRunById(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  return NextResponse.json(listRunActivity(id));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthFromRequest(req);
  const authError = requireAuth(auth);
  if (authError) return authError;

  const { id } = await params;
  const run = getRunById(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const body = await req.json();
  if (!body.content) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }

  let authorType: string;
  let authorId: string | null;
  let authorName: string;

  if (auth!.type === "user") {
    authorType = "user";
    authorId = auth!.userId;
    authorName = auth!.displayName;
  } else {
    authorType = "agent";
    authorId = auth!.agentId;
    authorName = auth!.agentName;
  }

  const entry = addRunActivity(id, authorType, authorId, authorName, body.content);

  // When a user responds to a waiting run, move to pending (ready for agent pickup)
  if (authorType === "user" && run.status === "waiting") {
    updateRunStatus(id, "pending");
    addRunActivity(id, "system", null, "System", "Status changed to **pending**");
  }

  return NextResponse.json(entry, { status: 201 });
}
