import { getDb, getDbAsync } from "./schema";
import { nowSql } from "./dialect";
import { v4 as uuid } from "uuid";

export function createDoc(title: string, content?: string, authorType?: string, authorId?: string) {
  const db = getDb();
  const id = uuid();
  db.prepare(
    `INSERT INTO docs (id, title, created_by_type, created_by_id) VALUES (?, ?, ?, ?)`
  ).run(id, title, authorType || null, authorId || null);

  if (content) {
    const revId = uuid();
    db.prepare(
      `INSERT INTO doc_revisions (id, doc_id, content, author_type, author_id) VALUES (?, ?, ?, ?, ?)`
    ).run(revId, id, content, authorType || null, authorId || null);
  }

  return getDocById(id);
}

export function getDocById(id: string) {
  const db = getDb();
  const doc = db.prepare(`SELECT * FROM docs WHERE id = ?`).get(id) as any;
  if (!doc) return null;

  const revision = db.prepare(
    `SELECT * FROM doc_revisions WHERE doc_id = ? ORDER BY created_at DESC LIMIT 1`
  ).get(id) as any;

  return { ...doc, content: revision?.content || "", last_revision: revision };
}

export function updateDoc(docId: string, content: string, authorType: string, authorId: string) {
  const db = getDb();
  const revId = uuid();
  db.prepare(
    `INSERT INTO doc_revisions (id, doc_id, content, author_type, author_id) VALUES (?, ?, ?, ?, ?)`
  ).run(revId, docId, content, authorType, authorId);
  db.prepare(`UPDATE docs SET updated_at = unixepoch() WHERE id = ?`).run(docId);
  return getDocById(docId);
}

export function renameDoc(docId: string, title: string) {
  const db = getDb();
  db.prepare(`UPDATE docs SET title = ?, updated_at = unixepoch() WHERE id = ?`).run(title, docId);
  return getDocById(docId);
}

export function deleteDoc(id: string) {
  const db = getDb();
  db.prepare(`DELETE FROM docs WHERE id = ?`).run(id);
}

export function listDocs(projectId?: string) {
  const db = getDb();
  if (projectId) {
    return db.prepare(`
      SELECT d.id, d.title, d.pinned, d.created_at, d.updated_at,
        (SELECT COUNT(*) FROM doc_revisions WHERE doc_id = d.id) as revision_count
      FROM docs d
      WHERE d.id IN (SELECT doc_id FROM project_docs WHERE project_id = ?)
      ORDER BY d.pinned DESC, d.title ASC
    `).all(projectId);
  }
  return db.prepare(`
    SELECT d.id, d.title, d.pinned, d.created_at, d.updated_at,
      (SELECT COUNT(*) FROM doc_revisions WHERE doc_id = d.id) as revision_count
    FROM docs d
    ORDER BY d.pinned DESC, d.title ASC
  `).all();
}

export function toggleDocPinned(id: string) {
  const db = getDb();
  db.prepare(`UPDATE docs SET pinned = CASE WHEN pinned = 1 THEN 0 ELSE 1 END, updated_at = unixepoch() WHERE id = ?`).run(id);
  return getDocById(id);
}

export function listPinnedDocIds(): string[] {
  const db = getDb();
  return (db.prepare(`SELECT id FROM docs WHERE pinned = 1`).all() as { id: string }[]).map(r => r.id);
}

export function getDocRevisions(docId: string) {
  const db = getDb();
  return db.prepare(`SELECT * FROM doc_revisions WHERE doc_id = ? ORDER BY created_at DESC`).all(docId);
}

// ---------------------------------------------------------------------------
// Async variants — cross-backend (SQLite + Postgres) via the adapter layer.
// ---------------------------------------------------------------------------

type DocRow = { id: string; title: string; created_by_type: string | null; created_by_id: string | null; pinned: number; created_at: number; updated_at: number };
type DocRevisionRow = { id: string; doc_id: string; content: string; author_type: string | null; author_id: string | null; created_at: number };

export async function createDocAsync(title: string, content?: string, authorType?: string, authorId?: string) {
  const db = await getDbAsync();
  const id = uuid();
  await db.run(
    `INSERT INTO docs (id, title, created_by_type, created_by_id) VALUES (?, ?, ?, ?)`,
    [id, title, authorType || null, authorId || null],
  );
  if (content) {
    const revId = uuid();
    await db.run(
      `INSERT INTO doc_revisions (id, doc_id, content, author_type, author_id) VALUES (?, ?, ?, ?, ?)`,
      [revId, id, content, authorType || null, authorId || null],
    );
  }
  return getDocByIdAsync(id);
}

export async function getDocByIdAsync(id: string) {
  const db = await getDbAsync();
  const doc = await db.get<DocRow>(`SELECT * FROM docs WHERE id = ?`, [id]);
  if (!doc) return null;
  const revision = await db.get<DocRevisionRow>(
    `SELECT * FROM doc_revisions WHERE doc_id = ? ORDER BY created_at DESC LIMIT 1`,
    [id],
  );
  return { ...doc, content: revision?.content || "", last_revision: revision };
}

export async function updateDocAsync(docId: string, content: string, authorType: string, authorId: string) {
  const db = await getDbAsync();
  const revId = uuid();
  await db.run(
    `INSERT INTO doc_revisions (id, doc_id, content, author_type, author_id) VALUES (?, ?, ?, ?, ?)`,
    [revId, docId, content, authorType, authorId],
  );
  await db.run(`UPDATE docs SET updated_at = ${nowSql(db)} WHERE id = ?`, [docId]);
  return getDocByIdAsync(docId);
}

export async function renameDocAsync(docId: string, title: string) {
  const db = await getDbAsync();
  await db.run(`UPDATE docs SET title = ?, updated_at = ${nowSql(db)} WHERE id = ?`, [title, docId]);
  return getDocByIdAsync(docId);
}

export async function deleteDocAsync(id: string) {
  const db = await getDbAsync();
  await db.run(`DELETE FROM docs WHERE id = ?`, [id]);
}

export async function listDocsAsync(projectId?: string) {
  const db = await getDbAsync();
  if (projectId) {
    return db.all(`
      SELECT d.id, d.title, d.pinned, d.created_at, d.updated_at,
        (SELECT COUNT(*) FROM doc_revisions WHERE doc_id = d.id) as revision_count
      FROM docs d
      WHERE d.id IN (SELECT doc_id FROM project_docs WHERE project_id = ?)
      ORDER BY d.pinned DESC, d.title ASC
    `, [projectId]);
  }
  return db.all(`
    SELECT d.id, d.title, d.pinned, d.created_at, d.updated_at,
      (SELECT COUNT(*) FROM doc_revisions WHERE doc_id = d.id) as revision_count
    FROM docs d
    ORDER BY d.pinned DESC, d.title ASC
  `);
}

export async function toggleDocPinnedAsync(id: string) {
  const db = await getDbAsync();
  await db.run(
    `UPDATE docs SET pinned = CASE WHEN pinned = 1 THEN 0 ELSE 1 END, updated_at = ${nowSql(db)} WHERE id = ?`,
    [id],
  );
  return getDocByIdAsync(id);
}

export async function listPinnedDocIdsAsync(): Promise<string[]> {
  const db = await getDbAsync();
  const rows = await db.all<{ id: string }>(`SELECT id FROM docs WHERE pinned = 1`);
  return rows.map(r => r.id);
}

export async function getDocRevisionsAsync(docId: string) {
  const db = await getDbAsync();
  return db.all<DocRevisionRow>(`SELECT * FROM doc_revisions WHERE doc_id = ? ORDER BY created_at DESC`, [docId]);
}
