import { NextRequest, NextResponse } from "next/server";
import { withAuth, withOperator } from "@/lib/auth";
import { getDatabaseByIdAsync, deleteDatabaseAsync, getDatabaseMigrationsAsync, getJobsForDatabaseAsync } from "@/lib/db/queries";

export const GET = withAuth(async (req, auth, { params }) => {
  const { id } = await params;
  const db = await getDatabaseByIdAsync(id);
  if (!db) return NextResponse.json({ error: "Database not found" }, { status: 404 });

  const migrations = await getDatabaseMigrationsAsync(id);
  const jobs = await getJobsForDatabaseAsync(id);
  return NextResponse.json({ ...db, migrations, jobs });
});

export const DELETE = withOperator(async (req, auth, { params }) => {
  const { id } = await params;
  await deleteDatabaseAsync(id);
  return NextResponse.json({ ok: true });
});
