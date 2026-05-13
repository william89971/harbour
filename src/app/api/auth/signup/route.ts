import { NextRequest, NextResponse } from "next/server";
import { createUserIfSignupEnabledAsync, isSignupEnabledAsync } from "@/lib/db/queries";
import { SignupDisabledError } from "@/lib/db/users";

export async function POST(req: NextRequest) {
  try {
    // Cheap upfront 403 (saves the body-parse + bcrypt round-trip when signup
    // is obviously off). The authoritative check lives inside the create
    // transaction below so an admin toggling the setting between this read
    // and the insert cannot leak a user through the TOCTOU window.
    if (!(await isSignupEnabledAsync())) {
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

    const user = await createUserIfSignupEnabledAsync(email, password, displayName);
    return NextResponse.json(user, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof SignupDisabledError) {
      return NextResponse.json({ error: "Signup is disabled" }, { status: 403 });
    }
    const err = error as { code?: string; message?: string };
    if (err?.code === "SQLITE_CONSTRAINT_UNIQUE" || err?.message?.includes("UNIQUE")) {
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
