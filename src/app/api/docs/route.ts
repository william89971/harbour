import { NextRequest, NextResponse } from "next/server";
import { withAuth, withOperator, getActorFromAuth } from "@/lib/auth";
import { requireTool } from "@/lib/tool-permissions";
import { listDocsAsync, createDocAsync } from "@/lib/db/queries";

export const GET = withAuth(async (req, auth) => {
  const readErr = requireTool(auth, "read_docs");
  if (readErr) return readErr;
  const projectId = req.nextUrl.searchParams.get("projectId") || undefined;
  return NextResponse.json(await listDocsAsync(projectId));
});

export const POST = withOperator(async (req, auth) => {
  const writeErr = requireTool(auth, "write_docs");
  if (writeErr) return writeErr;
  const body = await req.json();
  if (!body.title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const { actorType, actorId } = getActorFromAuth(auth);
  const doc = await createDocAsync(body.title, body.content, actorType, actorId);
  return NextResponse.json(doc, { status: 201 });
});
