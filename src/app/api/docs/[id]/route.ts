import { NextRequest, NextResponse } from "next/server";
import { getAuthFromRequest, requireAuth, getActorFromAuth } from "@/lib/auth";
import { getDocById, updateDoc, renameDoc, deleteDoc } from "@/lib/db/queries";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthFromRequest(req);
  const authError = requireAuth(auth);
  if (authError) return authError;

  const { id } = await params;
  const doc = getDocById(id);
  if (!doc) return NextResponse.json({ error: "Doc not found" }, { status: 404 });
  return NextResponse.json(doc);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthFromRequest(req);
  const authError = requireAuth(auth);
  if (authError) return authError;

  const { id } = await params;
  const existing = getDocById(id);
  if (!existing) return NextResponse.json({ error: "Doc not found" }, { status: 404 });

  const body = await req.json();
  const { actorType, actorId } = getActorFromAuth(auth!);

  if (body.title !== undefined) {
    renameDoc(id, body.title);
  }
  if (body.content !== undefined) {
    updateDoc(id, body.content, actorType, actorId);
  }

  return NextResponse.json(getDocById(id));
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthFromRequest(req);
  const authError = requireAuth(auth);
  if (authError) return authError;

  const { id } = await params;
  deleteDoc(id);
  return NextResponse.json({ ok: true });
}
