import { getDb } from "./schema";
import { v4 as uuid } from "uuid";
import { hashSync, compareSync } from "bcryptjs";

// ─── Users ───────────────────────────────────────────────────────────────────

export function createUser(email: string, password: string, displayName: string) {
  const db = getDb();
  const id = uuid();
  const passwordHash = hashSync(password, 10);
  db.prepare(
    `INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, ?, ?)`
  ).run(id, email, passwordHash, displayName);
  return getUserById(id);
}

export function authenticateUser(email: string, password: string) {
  const db = getDb();
  const user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email) as any;
  if (!user) return null;
  if (!compareSync(password, user.password_hash)) return null;
  return { id: user.id, email: user.email, display_name: user.display_name };
}

export function getUserById(id: string) {
  const db = getDb();
  const user = db.prepare(`SELECT id, email, display_name, created_at, updated_at FROM users WHERE id = ?`).get(id) as any;
  return user || null;
}

export function listUsers() {
  const db = getDb();
  return db.prepare(`SELECT id, email, display_name, created_at FROM users ORDER BY email`).all();
}

export function updateUser(id: string, data: { displayName?: string }) {
  const db = getDb();
  const fields: string[] = [];
  const values: any[] = [];
  if (data.displayName !== undefined) { fields.push("display_name = ?"); values.push(data.displayName); }
  if (fields.length === 0) return getUserById(id);
  fields.push("updated_at = unixepoch()");
  values.push(id);
  db.prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getUserById(id);
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
  const session = db.prepare(
    `SELECT s.*, u.id as uid, u.email, u.display_name FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.id = ? AND s.expires_at > ?`
  ).get(sessionId, now) as any;
  if (!session) return null;
  return { sessionId: session.id, userId: session.uid, email: session.email, displayName: session.display_name };
}

export function deleteSession(sessionId: string) {
  const db = getDb();
  db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
}
