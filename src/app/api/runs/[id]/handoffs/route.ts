import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { listOutgoingHandoffsAsync, listIncomingHandoffAsync } from "@/lib/db/queries";

export const GET = withAuth(async (_req, _auth, { params }) => {
  const { id } = await params;
  const [outgoing, incoming] = await Promise.all([
    listOutgoingHandoffsAsync(id),
    listIncomingHandoffAsync(id),
  ]);
  return NextResponse.json({ outgoing, incoming });
});
