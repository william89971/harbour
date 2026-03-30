import { NextRequest, NextResponse } from "next/server";
import { getAuthFromRequest, requireAuth } from "@/lib/auth";
import { listDatabases, createDatabase, getDatabaseByName } from "@/lib/db/queries";

export async function GET(req: NextRequest) {
  const auth = await getAuthFromRequest(req);
  const authError = requireAuth(auth);
  if (authError) return authError;

  return NextResponse.json(listDatabases());
}

export async function POST(req: NextRequest) {
  const auth = await getAuthFromRequest(req);
  const authError = requireAuth(auth);
  if (authError) return authError;

  const body = await req.json();
  if (!body.name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!body.columns?.length) return NextResponse.json({ error: "at least one column is required" }, { status: 400 });

  // If database already exists by name, return it
  const existing = getDatabaseByName(body.name);
  if (existing) return NextResponse.json(existing);

  try {
    const db = createDatabase(body.name, body.columns);
    return NextResponse.json(db, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
