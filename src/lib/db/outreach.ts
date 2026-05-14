import { getDb, getDbAsync } from "./schema";
import { nowSql } from "./dialect";
import { v4 as uuid } from "uuid";

export type OutreachStatus = "draft" | "pending_approval" | "approved" | "sent" | "rejected" | "archived";
export const OUTREACH_STATUSES: OutreachStatus[] = ["draft", "pending_approval", "approved", "sent", "rejected", "archived"];

export type OutreachDraftRow = {
  id: string;
  contact_id: string | null;
  company_id: string | null;
  subject: string;
  body: string;
  status: OutreachStatus;
  created_by_agent_id: string | null;
  approval_request_id: string | null;
  created_at: number;
  updated_at: number;
};

export type OutreachDraftRowWithJoins = OutreachDraftRow & {
  contact_name: string | null;
  contact_email: string | null;
  company_name: string | null;
};

export type CreateOutreachDraftInput = {
  contactId?: string | null;
  companyId?: string | null;
  subject: string;
  body: string;
  status?: OutreachStatus;
  createdByAgentId?: string | null;
};

export type UpdateOutreachDraftInput = {
  contactId?: string | null;
  companyId?: string | null;
  subject?: string;
  body?: string;
  status?: OutreachStatus;
  approvalRequestId?: string | null;
};

export type ListOutreachFilter = {
  statuses?: OutreachStatus[];
  contactId?: string;
};

// ---------------------------------------------------------------------------
// Sync helpers
// ---------------------------------------------------------------------------

export function createOutreachDraft(input: CreateOutreachDraftInput): OutreachDraftRow {
  const db = getDb();
  const id = uuid();
  db.prepare(
    `INSERT INTO outreach_drafts (id, contact_id, company_id, subject, body, status, created_by_agent_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.contactId ?? null,
    input.companyId ?? null,
    input.subject,
    input.body,
    input.status ?? "draft",
    input.createdByAgentId ?? null,
  );
  return getOutreachDraftById(id)!;
}

export function getOutreachDraftById(id: string): OutreachDraftRow | null {
  const db = getDb();
  return (db.prepare(`SELECT * FROM outreach_drafts WHERE id = ?`).get(id) as OutreachDraftRow | undefined) ?? null;
}

export function listOutreachDrafts(filter: ListOutreachFilter = {}): OutreachDraftRowWithJoins[] {
  const db = getDb();
  const where: string[] = [];
  const values: (string | number)[] = [];
  if (filter.statuses && filter.statuses.length > 0) {
    where.push(`o.status IN (${filter.statuses.map(() => "?").join(", ")})`);
    values.push(...filter.statuses);
  }
  if (filter.contactId) { where.push(`o.contact_id = ?`); values.push(filter.contactId); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return db.prepare(`
    SELECT o.*, c.name AS contact_name, c.email AS contact_email, co.name AS company_name
    FROM outreach_drafts o
    LEFT JOIN contacts c ON c.id = o.contact_id
    LEFT JOIN companies co ON co.id = o.company_id
    ${whereSql}
    ORDER BY o.updated_at DESC
  `).all(...values) as OutreachDraftRowWithJoins[];
}

export function updateOutreachDraft(id: string, input: UpdateOutreachDraftInput): OutreachDraftRow | null {
  const db = getDb();
  const fields: string[] = [];
  const values: (string | null)[] = [];
  if (input.contactId !== undefined) { fields.push("contact_id = ?"); values.push(input.contactId); }
  if (input.companyId !== undefined) { fields.push("company_id = ?"); values.push(input.companyId); }
  if (input.subject !== undefined) { fields.push("subject = ?"); values.push(input.subject); }
  if (input.body !== undefined) { fields.push("body = ?"); values.push(input.body); }
  if (input.status !== undefined) { fields.push("status = ?"); values.push(input.status); }
  if (input.approvalRequestId !== undefined) { fields.push("approval_request_id = ?"); values.push(input.approvalRequestId); }
  if (fields.length === 0) return getOutreachDraftById(id);
  fields.push("updated_at = unixepoch()");
  values.push(id);
  db.prepare(`UPDATE outreach_drafts SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getOutreachDraftById(id);
}

export function deleteOutreachDraft(id: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM outreach_drafts WHERE id = ?`).run(id);
}

// ---------------------------------------------------------------------------
// Async helpers
// ---------------------------------------------------------------------------

export async function createOutreachDraftAsync(input: CreateOutreachDraftInput): Promise<OutreachDraftRow> {
  const db = await getDbAsync();
  const id = uuid();
  await db.run(
    `INSERT INTO outreach_drafts (id, contact_id, company_id, subject, body, status, created_by_agent_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.contactId ?? null,
      input.companyId ?? null,
      input.subject,
      input.body,
      input.status ?? "draft",
      input.createdByAgentId ?? null,
    ],
  );
  return (await getOutreachDraftByIdAsync(id))!;
}

export async function getOutreachDraftByIdAsync(id: string): Promise<OutreachDraftRow | null> {
  const db = await getDbAsync();
  const row = await db.get<OutreachDraftRow>(`SELECT * FROM outreach_drafts WHERE id = ?`, [id]);
  return row ?? null;
}

export async function listOutreachDraftsAsync(filter: ListOutreachFilter = {}): Promise<OutreachDraftRowWithJoins[]> {
  const db = await getDbAsync();
  const where: string[] = [];
  const values: (string | number)[] = [];
  if (filter.statuses && filter.statuses.length > 0) {
    where.push(`o.status IN (${filter.statuses.map(() => "?").join(", ")})`);
    values.push(...filter.statuses);
  }
  if (filter.contactId) { where.push(`o.contact_id = ?`); values.push(filter.contactId); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return db.all<OutreachDraftRowWithJoins>(
    `SELECT o.*, c.name AS contact_name, c.email AS contact_email, co.name AS company_name
     FROM outreach_drafts o
     LEFT JOIN contacts c ON c.id = o.contact_id
     LEFT JOIN companies co ON co.id = o.company_id
     ${whereSql}
     ORDER BY o.updated_at DESC`,
    values,
  );
}

export async function updateOutreachDraftAsync(id: string, input: UpdateOutreachDraftInput): Promise<OutreachDraftRow | null> {
  const db = await getDbAsync();
  const fields: string[] = [];
  const values: (string | null)[] = [];
  if (input.contactId !== undefined) { fields.push("contact_id = ?"); values.push(input.contactId); }
  if (input.companyId !== undefined) { fields.push("company_id = ?"); values.push(input.companyId); }
  if (input.subject !== undefined) { fields.push("subject = ?"); values.push(input.subject); }
  if (input.body !== undefined) { fields.push("body = ?"); values.push(input.body); }
  if (input.status !== undefined) { fields.push("status = ?"); values.push(input.status); }
  if (input.approvalRequestId !== undefined) { fields.push("approval_request_id = ?"); values.push(input.approvalRequestId); }
  if (fields.length === 0) return getOutreachDraftByIdAsync(id);
  fields.push(`updated_at = ${nowSql(db)}`);
  values.push(id);
  await db.run(`UPDATE outreach_drafts SET ${fields.join(", ")} WHERE id = ?`, values);
  return getOutreachDraftByIdAsync(id);
}

export async function deleteOutreachDraftAsync(id: string): Promise<void> {
  const db = await getDbAsync();
  await db.run(`DELETE FROM outreach_drafts WHERE id = ?`, [id]);
}

export async function countOutreachByStatusAsync(statuses: OutreachStatus[]): Promise<number> {
  if (statuses.length === 0) return 0;
  const db = await getDbAsync();
  const placeholders = statuses.map(() => "?").join(", ");
  const row = await db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM outreach_drafts WHERE status IN (${placeholders})`,
    statuses,
  );
  return Number(row?.n ?? 0);
}
