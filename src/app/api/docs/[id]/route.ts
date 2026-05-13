import { NextRequest, NextResponse } from "next/server";
import { withAuth, withOperator, getActorFromAuth } from "@/lib/auth";
import { requireTool } from "@/lib/tool-permissions";
import { getDocByIdAsync, updateDocAsync, renameDocAsync, deleteDocAsync } from "@/lib/db/queries";

export const GET = withAuth(async (req, auth, { params }) => {
  const readErr = requireTool(auth, "read_docs");
  if (readErr) return readErr;
  const { id } = await params;
  const doc = await getDocByIdAsync(id);
  if (!doc) return NextResponse.json({ error: "Doc not found" }, { status: 404 });
  return NextResponse.json(doc);
});

export const PUT = withOperator(async (req, auth, { params }) => {
  const writeErr = requireTool(auth, "write_docs");
  if (writeErr) return writeErr;
  const { id } = await params;
  const existing = await getDocByIdAsync(id);
  if (!existing) return NextResponse.json({ error: "Doc not found" }, { status: 404 });

  const body = await req.json();
  const { actorType, actorId } = getActorFromAuth(auth);

  if (body.title !== undefined) {
    await renameDocAsync(id, body.title);
  }
  if (body.content !== undefined) {
    await updateDocAsync(id, body.content, actorType, actorId);
  }

  return NextResponse.json(await getDocByIdAsync(id));
});

export const DELETE = withOperator(async (req, auth, { params }) => {
  const writeErr = requireTool(auth, "write_docs");
  if (writeErr) return writeErr;
  const { id } = await params;
  await deleteDocAsync(id);
  return NextResponse.json({ ok: true });
});
