import { NextRequest, NextResponse } from "next/server";
import { getAuthFromRequest, requireAuth, getActorFromAuth } from "@/lib/auth";
import { listDocs, createDoc } from "@/lib/db/queries";

export async function GET(req: NextRequest) {
  const auth = await getAuthFromRequest(req);
  const authError = requireAuth(auth);
  if (authError) return authError;

  return NextResponse.json(listDocs());
}

export async function POST(req: NextRequest) {
  const auth = await getAuthFromRequest(req);
  const authError = requireAuth(auth);
  if (authError) return authError;

  const body = await req.json();
  if (!body.title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const { actorType, actorId } = getActorFromAuth(auth!);
  const doc = createDoc(body.title, body.content, actorType, actorId);
  return NextResponse.json(doc, { status: 201 });
}
