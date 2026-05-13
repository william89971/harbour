import { getDb, getDbAsync } from "./schema";
import { nowSql } from "./dialect";
import { v4 as uuid } from "uuid";
import crypto from "crypto";

function generateAdminApiKey(): string {
  return "hbr_adm_" + crypto.randomBytes(32).toString("hex");
}

function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export function createAdminApiKey(name: string, createdByUserId: string) {
  const db = getDb();
  const id = uuid();
  const apiKey = generateAdminApiKey();
  const apiKeyHash = hashApiKey(apiKey);
  db.prepare(
    `INSERT INTO admin_api_keys (id, name, api_key_hash, created_by_user_id) VALUES (?, ?, ?, ?)`
  ).run(id, name, apiKeyHash, createdByUserId);
  return { id, name, apiKey };
}

export function listAdminApiKeys() {
  const db = getDb();
  return db.prepare(
    `SELECT k.id, k.name, k.last_used_at, k.created_at, u.display_name as created_by
     FROM admin_api_keys k
     JOIN users u ON k.created_by_user_id = u.id
     ORDER BY k.created_at DESC`
  ).all();
}

export function deleteAdminApiKey(id: string) {
  const db = getDb();
  db.prepare(`DELETE FROM admin_api_keys WHERE id = ?`).run(id);
}

export function authenticateAdminApiKey(apiKey: string) {
  const db = getDb();
  const hash = hashApiKey(apiKey);
  const row = db.prepare(
    `SELECT k.id, k.name, k.created_by_user_id, u.email, u.display_name, u.role
     FROM admin_api_keys k
     JOIN users u ON k.created_by_user_id = u.id
     WHERE k.api_key_hash = ?`
  ).get(hash) as { id: string; name: string; created_by_user_id: string; email: string; display_name: string; role: string } | undefined;
  if (row) {
    db.prepare(`UPDATE admin_api_keys SET last_used_at = unixepoch() WHERE id = ?`).run(row.id);
  }
  return row || null;
}

// ---------------------------------------------------------------------------
// Async variants — cross-backend (SQLite + Postgres) via the adapter layer.
// ---------------------------------------------------------------------------

export async function createAdminApiKeyAsync(name: string, createdByUserId: string) {
  const db = await getDbAsync();
  const id = uuid();
  const apiKey = generateAdminApiKey();
  const apiKeyHash = hashApiKey(apiKey);
  await db.run(
    `INSERT INTO admin_api_keys (id, name, api_key_hash, created_by_user_id) VALUES (?, ?, ?, ?)`,
    [id, name, apiKeyHash, createdByUserId],
  );
  return { id, name, apiKey };
}

export async function listAdminApiKeysAsync() {
  const db = await getDbAsync();
  return db.all(
    `SELECT k.id, k.name, k.last_used_at, k.created_at, u.display_name as created_by
     FROM admin_api_keys k
     JOIN users u ON k.created_by_user_id = u.id
     ORDER BY k.created_at DESC`,
  );
}

export async function deleteAdminApiKeyAsync(id: string) {
  const db = await getDbAsync();
  await db.run(`DELETE FROM admin_api_keys WHERE id = ?`, [id]);
}

export async function authenticateAdminApiKeyAsync(apiKey: string) {
  const db = await getDbAsync();
  const hash = hashApiKey(apiKey);
  const row = await db.get<{ id: string; name: string; created_by_user_id: string; email: string; display_name: string }>(
    `SELECT k.id, k.name, k.created_by_user_id, u.email, u.display_name
     FROM admin_api_keys k
     JOIN users u ON k.created_by_user_id = u.id
     WHERE k.api_key_hash = ?`,
    [hash],
  );
  if (row) {
    await db.run(`UPDATE admin_api_keys SET last_used_at = ${nowSql(db)} WHERE id = ?`, [row.id]);
  }
  return row;
}
