import { NextRequest, NextResponse } from "next/server";
import { createUser, isSignupEnabled } from "@/lib/db/queries";

export async function POST(req: NextRequest) {
  try {
    if (!isSignupEnabled()) {
      return NextResponse.json({ error: "Signup is disabled" }, { status: 403 });
    }

    const body = await req.json();
    const { email, password, displayName } = body;

    if (!email || !password || !displayName) {
      return NextResponse.json(
        { error: "email, password, and displayName are required" },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 }
      );
    }

    const user = createUser(email, password, displayName);
    return NextResponse.json(user, { status: 201 });
  } catch (error: any) {
    if (error?.code === "SQLITE_CONSTRAINT_UNIQUE" || error?.message?.includes("UNIQUE")) {
      return NextResponse.json(
        { error: "Email already exists" },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "Failed to create user" },
      { status: 500 }
    );
  }
}
