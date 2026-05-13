import crypto from "crypto";
import { getDb, getDbAsync } from "./schema";
import { nowSql } from "./dialect";

// ── Types ──────────────────────────────────────────────────────────────

export type CaptainConversation = {
  id: string;
  title: string;
  cli: string;
  model: string | null;
  thinking: string | null;
  session_id: string | null;
  cwd: string | null;
  user_id: string;
  created_at: number;
  updated_at: number;
};

export type CaptainMessage = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: number;
};

export type CaptainOutputEvent = {
  id: number;
  conversation_id: string;
  message_id: string | null;
  event_type: string;
  content: string | null;
  tool_name: string | null;
  created_at: number;
};

// ── Conversations ──────────────────────────────────────────────────────

export function listConversations(userId: string): CaptainConversation[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM captain_conversations WHERE user_id = ? ORDER BY updated_at DESC`
    )
    .all(userId) as CaptainConversation[];
}

export function getConversation(
  id: string
): CaptainConversation | undefined {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM captain_conversations WHERE id = ?`)
    .get(id) as CaptainConversation | undefined;
}

export function createConversation(
  title: string,
  cli: string,
  model: string | null,
  thinking: string | null,
  cwd: string | null,
  userId: string
): CaptainConversation {
  const db = getDb();
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO captain_conversations (id, title, cli, model, thinking, cwd, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, title, cli, model || null, thinking || null, cwd || null, userId);
  return getConversation(id)!;
}

export function updateConversation(
  id: string,
  updates: Partial<
    Pick<CaptainConversation, "title" | "session_id" | "updated_at">
  >
) {
  const db = getDb();
  const sets: string[] = [];
  const vals: unknown[] = [];

  if (updates.title !== undefined) {
    sets.push("title = ?");
    vals.push(updates.title);
  }
  if (updates.session_id !== undefined) {
    sets.push("session_id = ?");
    vals.push(updates.session_id);
  }
  sets.push("updated_at = unixepoch()");
  vals.push(id);

  db.prepare(
    `UPDATE captain_conversations SET ${sets.join(", ")} WHERE id = ?`
  ).run(...vals);
}

export function deleteConversation(id: string) {
  const db = getDb();
  db.prepare(`DELETE FROM captain_conversations WHERE id = ?`).run(id);
}

// ── Messages ───────────────────────────────────────────────────────────

export function listMessages(conversationId: string): CaptainMessage[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM captain_messages WHERE conversation_id = ? ORDER BY created_at ASC`
    )
    .all(conversationId) as CaptainMessage[];
}

export function createMessage(
  conversationId: string,
  role: "user" | "assistant",
  content: string = ""
): CaptainMessage {
  const db = getDb();
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO captain_messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)`
  ).run(id, conversationId, role, content);
  db.prepare(
    `UPDATE captain_conversations SET updated_at = unixepoch() WHERE id = ?`
  ).run(conversationId);
  return db
    .prepare(`SELECT * FROM captain_messages WHERE id = ?`)
    .get(id) as CaptainMessage;
}

export function updateMessageContent(id: string, content: string) {
  const db = getDb();
  db.prepare(`UPDATE captain_messages SET content = ? WHERE id = ?`).run(
    content,
    id
  );
}

// ── Output (streaming events) ──────────────────────────────────────────

export function addCaptainOutput(
  conversationId: string,
  messageId: string,
  events: { event_type: string; content: string | null; tool_name: string | null }[]
) {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO captain_output (conversation_id, message_id, event_type, content, tool_name) VALUES (?, ?, ?, ?, ?)`
  );
  const insertMany = db.transaction(
    (evts: typeof events) => {
      for (const e of evts) {
        stmt.run(conversationId, messageId, e.event_type, e.content, e.tool_name);
      }
    }
  );
  insertMany(events);
}

export function listCaptainOutput(
  conversationId: string,
  afterId: number = 0,
  messageId?: string
): CaptainOutputEvent[] {
  const db = getDb();
  if (messageId) {
    return db
      .prepare(
        `SELECT * FROM captain_output WHERE conversation_id = ? AND message_id = ? AND id > ? ORDER BY id ASC`
      )
      .all(conversationId, messageId, afterId) as CaptainOutputEvent[];
  }
  return db
    .prepare(
      `SELECT * FROM captain_output WHERE conversation_id = ? AND id > ? ORDER BY id ASC`
    )
    .all(conversationId, afterId) as CaptainOutputEvent[];
}

export function listToolEventsByMessage(messageId: string): CaptainOutputEvent[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM captain_output WHERE message_id = ? AND event_type IN ('tool_start', 'tool_end') ORDER BY id ASC`
    )
    .all(messageId) as CaptainOutputEvent[];
}

export function deleteCaptainOutput(conversationId: string) {
  const db = getDb();
  db.prepare(`DELETE FROM captain_output WHERE conversation_id = ?`).run(
    conversationId
  );
}

// ---------------------------------------------------------------------------
// Async variants — cross-backend (SQLite + Postgres) via the adapter layer.
// ---------------------------------------------------------------------------

export async function listConversationsAsync(userId: string): Promise<CaptainConversation[]> {
  const db = await getDbAsync();
  return db.all<CaptainConversation>(`SELECT * FROM captain_conversations WHERE user_id = ? ORDER BY updated_at DESC`, [userId]);
}

export async function getConversationAsync(id: string): Promise<CaptainConversation | null> {
  const db = await getDbAsync();
  return db.get<CaptainConversation>(`SELECT * FROM captain_conversations WHERE id = ?`, [id]);
}

export async function createConversationAsync(
  title: string,
  cli: string,
  model: string | null,
  thinking: string | null,
  cwd: string | null,
  userId: string,
): Promise<CaptainConversation> {
  const db = await getDbAsync();
  const id = crypto.randomUUID();
  await db.run(
    `INSERT INTO captain_conversations (id, title, cli, model, thinking, cwd, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, title, cli, model || null, thinking || null, cwd || null, userId],
  );
  const row = await getConversationAsync(id);
  return row!;
}

export async function updateConversationAsync(
  id: string,
  updates: Partial<Pick<CaptainConversation, "title" | "session_id" | "updated_at">>,
) {
  const db = await getDbAsync();
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  if (updates.title !== undefined) { sets.push("title = ?"); vals.push(updates.title); }
  if (updates.session_id !== undefined) { sets.push("session_id = ?"); vals.push(updates.session_id); }
  sets.push(`updated_at = ${nowSql(db)}`);
  vals.push(id);
  await db.run(`UPDATE captain_conversations SET ${sets.join(", ")} WHERE id = ?`, vals);
}

export async function deleteConversationAsync(id: string) {
  const db = await getDbAsync();
  await db.run(`DELETE FROM captain_conversations WHERE id = ?`, [id]);
}

export async function listMessagesAsync(conversationId: string): Promise<CaptainMessage[]> {
  const db = await getDbAsync();
  return db.all<CaptainMessage>(`SELECT * FROM captain_messages WHERE conversation_id = ? ORDER BY created_at ASC`, [conversationId]);
}

export async function createMessageAsync(
  conversationId: string,
  role: "user" | "assistant",
  content: string = "",
): Promise<CaptainMessage> {
  const db = await getDbAsync();
  const id = crypto.randomUUID();
  await db.run(
    `INSERT INTO captain_messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)`,
    [id, conversationId, role, content],
  );
  await db.run(`UPDATE captain_conversations SET updated_at = ${nowSql(db)} WHERE id = ?`, [conversationId]);
  const row = await db.get<CaptainMessage>(`SELECT * FROM captain_messages WHERE id = ?`, [id]);
  return row!;
}

export async function updateMessageContentAsync(id: string, content: string) {
  const db = await getDbAsync();
  await db.run(`UPDATE captain_messages SET content = ? WHERE id = ?`, [content, id]);
}

export async function addCaptainOutputAsync(
  conversationId: string,
  messageId: string,
  events: { event_type: string; content: string | null; tool_name: string | null }[],
) {
  if (events.length === 0) return;
  const db = await getDbAsync();
  await db.transaction(async (tx) => {
    for (const e of events) {
      await tx.run(
        `INSERT INTO captain_output (conversation_id, message_id, event_type, content, tool_name) VALUES (?, ?, ?, ?, ?)`,
        [conversationId, messageId, e.event_type, e.content, e.tool_name],
      );
    }
  });
}

export async function listCaptainOutputAsync(
  conversationId: string,
  afterId: number = 0,
  messageId?: string,
): Promise<CaptainOutputEvent[]> {
  const db = await getDbAsync();
  if (messageId) {
    return db.all<CaptainOutputEvent>(
      `SELECT * FROM captain_output WHERE conversation_id = ? AND message_id = ? AND id > ? ORDER BY id ASC`,
      [conversationId, messageId, afterId],
    );
  }
  return db.all<CaptainOutputEvent>(
    `SELECT * FROM captain_output WHERE conversation_id = ? AND id > ? ORDER BY id ASC`,
    [conversationId, afterId],
  );
}

export async function listToolEventsByMessageAsync(messageId: string): Promise<CaptainOutputEvent[]> {
  const db = await getDbAsync();
  return db.all<CaptainOutputEvent>(
    `SELECT * FROM captain_output WHERE message_id = ? AND event_type IN ('tool_start', 'tool_end') ORDER BY id ASC`,
    [messageId],
  );
}

export async function deleteCaptainOutputAsync(conversationId: string) {
  const db = await getDbAsync();
  await db.run(`DELETE FROM captain_output WHERE conversation_id = ?`, [conversationId]);
}
