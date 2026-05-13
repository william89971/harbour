import { NextRequest, NextResponse } from "next/server";
import { withAuth, withOperator } from "@/lib/auth";
import { requireTool } from "@/lib/tool-permissions";
import { listDatabasesAsync, createDatabaseAsync, getDatabaseByNameAsync } from "@/lib/db/queries";

export const GET = withAuth(async (req, auth) => {
  const readErr = requireTool(auth, "read_databases");
  if (readErr) return readErr;
  const projectId = req.nextUrl.searchParams.get("projectId") || undefined;
  return NextResponse.json(await listDatabasesAsync(projectId));
});

export const POST = withOperator(async (req, auth) => {
  const writeErr = requireTool(auth, "write_databases");
  if (writeErr) return writeErr;
  const body = await req.json();
  if (!body.name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!body.columns?.length) return NextResponse.json({ error: "at least one column is required" }, { status: 400 });

  // If database already exists by name, return it
  const existing = await getDatabaseByNameAsync(body.name);
  if (existing) return NextResponse.json(existing);

  try {
    const db = await createDatabaseAsync(body.name, body.columns);
    return NextResponse.json(db, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
});
