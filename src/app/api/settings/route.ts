import { NextRequest, NextResponse } from "next/server";
import { withAuth, withUserAuth } from "@/lib/auth";
import { getAllSettings, setSetting } from "@/lib/db/queries";

export const GET = withAuth(async () => {
  return NextResponse.json(getAllSettings());
});

export const PUT = withUserAuth(async (req) => {
  const body = await req.json();
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string") {
      setSetting(key, value);
    }
  }

  return NextResponse.json(getAllSettings());
});
