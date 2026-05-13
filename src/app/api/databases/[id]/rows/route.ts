import { NextRequest, NextResponse } from "next/server";
import { withAuth, withOperator } from "@/lib/auth";
import { requireTool } from "@/lib/tool-permissions";
import { getDatabaseByIdAsync, getRowsAsync, insertRowsAsync } from "@/lib/db/queries";

export const GET = withAuth(async (req, auth, { params }) => {
  const readErr = requireTool(auth, "read_databases");
  if (readErr) return readErr;
  const { id } = await params;
  const db = await getDatabaseByIdAsync(id);
  if (!db) return NextResponse.json({ error: "Database not found" }, { status: 404 });

  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") || "100");
  const offset = parseInt(url.searchParams.get("offset") || "0");
  const orderBy = url.searchParams.get("orderBy") || undefined;
  const order = (url.searchParams.get("order") || "DESC") as "ASC" | "DESC";

  const result = await getRowsAsync(id, { limit, offset, orderBy, order });
  return NextResponse.json(result);
});

export const POST = withOperator(async (req, auth, { params }) => {
  const writeErr = requireTool(auth, "write_databases");
  if (writeErr) return writeErr;
  const { id } = await params;
  const db = await getDatabaseByIdAsync(id);
  if (!db) return NextResponse.json({ error: "Database not found" }, { status: 404 });

  const body = await req.json();
  const rows = Array.isArray(body) ? body : [body];

  try {
    const result = await insertRowsAsync(id, rows);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
});
