import { NextRequest, NextResponse } from "next/server";
import { getAuthFromRequest, requireAuth } from "@/lib/auth";
import { getRunById, addRunOutput, listRunOutput } from "@/lib/db/queries";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthFromRequest(req);
  const authError = requireAuth(auth);
  if (authError) return authError;

  const { id } = await params;
  const run = getRunById(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const afterId = parseInt(req.nextUrl.searchParams.get("after") || "0", 10);
  return NextResponse.json(listRunOutput(id, afterId));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthFromRequest(req);
  const authError = requireAuth(auth);
  if (authError) return authError;

  const { id } = await params;
  const run = getRunById(id);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

  const body = await req.json();
  const events = Array.isArray(body) ? body : [body];

  if (events.length === 0 || !events.every((e: any) => e.event_type)) {
    return NextResponse.json({ error: "event_type is required for each event" }, { status: 400 });
  }

  addRunOutput(id, events.map((e: any) => ({
    event_type: e.event_type,
    content: e.content || null,
    tool_name: e.tool_name || null,
  })));

  return NextResponse.json({ ok: true }, { status: 201 });
}
