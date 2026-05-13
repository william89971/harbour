import { getDb, getDbAsync } from "./schema";
import { nowSql } from "./dialect";
import { v4 as uuid } from "uuid";
import { hashSync, compareSync } from "bcryptjs";

export type UserRole = "admin" | "operator" | "viewer";
export const USER_ROLES: UserRole[] = ["admin", "operator", "viewer"];
export function isValidUserRole(role: string): role is UserRole {
  return (USER_ROLES as string[]).includes(role);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UserRow = { id: string; email: string; password_hash: string; display_name: string; role: UserRole; created_at: number; updated_at: number };
type SessionJoin = { id: string; uid: string; email: string; display_name: string; role: UserRole; expires_at: number };

// ─── Users ───────────────────────────────────────────────────────────────────

export function createUser(email: string, password: string, displayName: string, role: UserRole = "admin") {
  const db = getDb();
  const id = uuid();
  const passwordHash = hashSync(password, 10);
  if (!isValidUserRole(role)) throw new Error(`invalid role: ${role}`);
  db.prepare(
    `INSERT INTO users (id, email, password_hash, display_name, role) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, email, passwordHash, displayName, role);
  return getUserById(id);
}

export function authenticateUser(email: string, password: string) {
  const db = getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email) as any;
  if (!user) return null;
  if (!compareSync(password, user.password_hash)) return null;
  return { id: user.id, email: user.email, display_name: user.display_name, role: user.role as UserRole };
}

export function getUserById(id: string) {
  const db = getDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const user = db.prepare(`SELECT id, email, display_name, role, created_at, updated_at FROM users WHERE id = ?`).get(id) as any;
  return user || null;
}

export function listUsers() {
  const db = getDb();
  return db.prepare(`SELECT id, email, display_name, role, created_at FROM users ORDER BY email`).all();
}

export function updateUser(id: string, data: { displayName?: string; role?: UserRole }) {
  const db = getDb();
  const fields: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const values: any[] = [];
  if (data.displayName !== undefined) { fields.push("display_name = ?"); values.push(data.displayName); }
  if (data.role !== undefined) {
    if (!isValidUserRole(data.role)) throw new Error(`invalid role: ${data.role}`);
    fields.push("role = ?"); values.push(data.role);
  }
  if (fields.length === 0) return getUserById(id);
  fields.push("updated_at = unixepoch()");
  values.push(id);
  db.prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getUserById(id);
}

export function deleteUser(id: string) {
  const db = getDb();
  db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
}

export function countAdmins(): number {
  const db = getDb();
  const row = db.prepare(`SELECT COUNT(*) as c FROM users WHERE role = 'admin'`).get() as { c: number };
  return row.c;
}

// ─── Sessions ────────────────────────────────────────────────────────────────

export function createSession(userId: string): string {
  const db = getDb();
  const id = uuid();
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30; // 30 days
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`).run(id, userId, expiresAt);
  return id;
}

export function getSession(sessionId: string) {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const session = db.prepare(
    `SELECT s.*, u.id as uid, u.email, u.display_name, u.role FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.id = ? AND s.expires_at > ?`,
  ).get(sessionId, now) as any;
  if (!session) return null;
  return { sessionId: session.id, userId: session.uid, email: session.email, displayName: session.display_name, role: session.role as UserRole };
}

export function deleteSession(sessionId: string) {
  const db = getDb();
  db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
}

// ---------------------------------------------------------------------------
// Async variants — cross-backend (SQLite + Postgres) via the adapter layer.
// ---------------------------------------------------------------------------

export async function createUserAsync(email: string, password: string, displayName: string, role: UserRole = "admin") {
  const db = await getDbAsync();
  const id = uuid();
  const passwordHash = hashSync(password, 10);
  if (!isValidUserRole(role)) throw new Error(`invalid role: ${role}`);
  await db.run(
    `INSERT INTO users (id, email, password_hash, display_name, role) VALUES (?, ?, ?, ?, ?)`,
    [id, email, passwordHash, displayName, role],
  );
  return getUserByIdAsync(id);
}

/** Thrown when signup is disabled at the time the transaction tries to commit.
 *  Distinct from generic errors so the route can map it to a clean 403. */
export class SignupDisabledError extends Error {
  constructor() { super("Signup is disabled"); this.name = "SignupDisabledError"; }
}

/**
 * Create a user only if `signup_enabled` is still true at the moment of the
 * INSERT. Both reads happen inside a single transaction, so an admin toggling
 * signup off between a route's gate-check and its insert cannot accidentally
 * let a user slip through.
 */
export async function createUserIfSignupEnabledAsync(email: string, password: string, displayName: string, role: UserRole = "admin") {
  if (!isValidUserRole(role)) throw new Error(`invalid role: ${role}`);
  const db = await getDbAsync();
  const id = uuid();
  const passwordHash = hashSync(password, 10);
  await db.transaction(async (tx) => {
    const row = await tx.get<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, ["signup_enabled"]);
    // Default is "enabled" (matches isSignupEnabledAsync semantics) when no
    // row is present.
    const enabled = !row || row.value === "true";
    if (!enabled) throw new SignupDisabledError();
    await tx.run(
      `INSERT INTO users (id, email, password_hash, display_name, role) VALUES (?, ?, ?, ?, ?)`,
      [id, email, passwordHash, displayName, role],
    );
  });
  return getUserByIdAsync(id);
}

export async function authenticateUserAsync(email: string, password: string) {
  const db = await getDbAsync();
  const user = await db.get<UserRow>(`SELECT * FROM users WHERE email = ?`, [email]);
  if (!user) return null;
  if (!compareSync(password, user.password_hash)) return null;
  return { id: user.id, email: user.email, display_name: user.display_name, role: user.role };
}

export async function getUserByIdAsync(id: string) {
  const db = await getDbAsync();
  return db.get<{ id: string; email: string; display_name: string; role: UserRole; created_at: number; updated_at: number }>(
    `SELECT id, email, display_name, role, created_at, updated_at FROM users WHERE id = ?`,
    [id],
  );
}

export async function listUsersAsync() {
  const db = await getDbAsync();
  return db.all(`SELECT id, email, display_name, role, created_at FROM users ORDER BY email`);
}

export async function updateUserAsync(id: string, data: { displayName?: string; role?: UserRole }) {
  const db = await getDbAsync();
  const fields: string[] = [];
  const values: (string | number)[] = [];
  if (data.displayName !== undefined) { fields.push("display_name = ?"); values.push(data.displayName); }
  if (data.role !== undefined) {
    if (!isValidUserRole(data.role)) throw new Error(`invalid role: ${data.role}`);
    fields.push("role = ?"); values.push(data.role);
  }
  if (fields.length === 0) return getUserByIdAsync(id);
  fields.push(`updated_at = ${nowSql(db)}`);
  values.push(id);
  await db.run(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`, values);
  return getUserByIdAsync(id);
}

export async function deleteUserAsync(id: string) {
  const db = await getDbAsync();
  await db.run(`DELETE FROM users WHERE id = ?`, [id]);
}

export async function countAdminsAsync(): Promise<number> {
  const db = await getDbAsync();
  const row = await db.get<{ c: number }>(`SELECT COUNT(*) as c FROM users WHERE role = 'admin'`);
  return row?.c || 0;
}

export async function createSessionAsync(userId: string): Promise<string> {
  const db = await getDbAsync();
  const id = uuid();
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;
  await db.run(`INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`, [id, userId, expiresAt]);
  return id;
}

export async function getSessionAsync(sessionId: string) {
  const db = await getDbAsync();
  const now = Math.floor(Date.now() / 1000);
  const session = await db.get<SessionJoin>(
    `SELECT s.id as id, s.expires_at, u.id as uid, u.email, u.display_name, u.role
     FROM sessions s JOIN users u ON s.user_id = u.id
     WHERE s.id = ? AND s.expires_at > ?`,
    [sessionId, now],
  );
  if (!session) return null;
  return { sessionId: session.id, userId: session.uid, email: session.email, displayName: session.display_name, role: session.role };
}

export async function deleteSessionAsync(sessionId: string) {
  const db = await getDbAsync();
  await db.run(`DELETE FROM sessions WHERE id = ?`, [sessionId]);
}
