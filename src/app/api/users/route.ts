import { NextResponse } from "next/server";
// User-only: the user list is operator/admin tooling, not part of the agent
// contract. With bare withAuth, any agent Bearer token could enumerate users.
import { withUserAuth } from "@/lib/auth";
import { listUsersAsync } from "@/lib/db/queries";

export const GET = withUserAuth(async () => {
  return NextResponse.json(await listUsersAsync());
});
