/**
 * Signup gate TOCTOU close (Pass 3).
 *
 * The old POST /api/auth/signup path was:
 *   1. await isSignupEnabledAsync()       // read setting
 *   2. await createUserAsync(...)          // insert user
 * which left a window where an admin disabling signup between step 1 and
 * step 2 still let the in-flight request succeed. `createUserIfSignupEnabledAsync`
 * re-reads the setting inside the SAME transaction as the INSERT, so the
 * setting cannot change between check and write.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { setDb, resetDb, initializeSchema } from "@/lib/db/schema";
import {
  createUserIfSignupEnabledAsync,
  setSettingAsync,
  getUserByIdAsync,
} from "@/lib/db/queries";
import { SignupDisabledError } from "@/lib/db/users";

function freshDb() {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

beforeEach(() => {
  const db = freshDb();
  setDb(db);
  initializeSchema(db);
});

afterEach(() => {
  resetDb();
});

describe("signup TOCTOU close", () => {
  it("createUserIfSignupEnabledAsync creates a user when signup is enabled (default)", async () => {
    const u = await createUserIfSignupEnabledAsync("ok@x", "longpassword", "OK");
    expect(u).toBeTruthy();
    expect(u!.email).toBe("ok@x");
  });

  it("createUserIfSignupEnabledAsync creates a user when signup_enabled is explicitly true", async () => {
    await setSettingAsync("signup_enabled", "true");
    const u = await createUserIfSignupEnabledAsync("ok2@x", "longpassword", "OK2");
    expect(u).toBeTruthy();
  });

  it("createUserIfSignupEnabledAsync throws SignupDisabledError when signup_enabled is false", async () => {
    await setSettingAsync("signup_enabled", "false");
    await expect(
      createUserIfSignupEnabledAsync("blocked@x", "longpassword", "Blocked"),
    ).rejects.toBeInstanceOf(SignupDisabledError);
  });

  it("user is NOT inserted when SignupDisabledError fires (transaction rolls back)", async () => {
    await setSettingAsync("signup_enabled", "false");
    try {
      await createUserIfSignupEnabledAsync("rollback@x", "longpassword", "Roll");
    } catch { /* expected */ }
    // No user with this email should exist — count by listing.
    const { listUsersAsync } = await import("@/lib/db/queries");
    const users = await listUsersAsync() as { email: string }[];
    expect(users.some((u) => u.email === "rollback@x")).toBe(false);
  });

  it("toggle to false BETWEEN gate-call-1 and gate-call-2 still blocks (no TOCTOU)", async () => {
    // Simulate the race: an admin disables signup after the cheap upfront
    // 403 check passes. The transactional re-check inside the helper must
    // still catch it and refuse.
    await setSettingAsync("signup_enabled", "true");
    // (gate-1 read happens at the route level — not modeled here)
    await setSettingAsync("signup_enabled", "false");
    await expect(
      createUserIfSignupEnabledAsync("racy@x", "longpassword", "Racy"),
    ).rejects.toBeInstanceOf(SignupDisabledError);
    const { listUsersAsync } = await import("@/lib/db/queries");
    const users = await listUsersAsync() as { email: string }[];
    expect(users.some((u) => u.email === "racy@x")).toBe(false);
  });

  it("getUserByIdAsync still works after a successful create (sanity check on the new tx path)", async () => {
    const u = await createUserIfSignupEnabledAsync("sanity@x", "longpassword", "Sanity");
    const fetched = await getUserByIdAsync(u!.id);
    expect(fetched?.email).toBe("sanity@x");
  });
});
