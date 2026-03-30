import { NextRequest, NextResponse } from "next/server";
import { getAuthFromRequest, requireAuth } from "@/lib/auth";
import { getAgentById, createDatabase, getDatabaseByName, insertRows, linkDatabaseToJob } from "@/lib/db/queries";

// POST: Agent creates a database and optionally links it to a job + inserts initial rows
// This is the convenience endpoint for agents — combines create + link + seed in one call
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthFromRequest(req);
  const authError = requireAuth(auth);
  if (authError) return authError;

  const { id } = await params;
  const agent = getAgentById(id);
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const body = await req.json();
  if (!body.name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  try {
    // Get or create the database
    let db = getDatabaseByName(body.name);
    const created = !db;
    if (!db) {
      if (!body.columns?.length) {
        return NextResponse.json({ error: "columns are required when creating a new database" }, { status: 400 });
      }
      db = createDatabase(body.name, body.columns);
    }

    // Link to job if specified
    if (body.jobId) {
      linkDatabaseToJob(body.jobId, db.id);
    }

    // Insert initial rows if provided
    if (body.rows?.length) {
      insertRows(db.id, body.rows);
    }

    return NextResponse.json(db, { status: created ? 201 : 200 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
