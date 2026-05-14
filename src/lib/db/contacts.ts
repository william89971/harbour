import { getDb, getDbAsync } from "./schema";
import { nowSql } from "./dialect";
import { v4 as uuid } from "uuid";

export type ContactStatus = "new" | "researched" | "drafted" | "contacted" | "replied" | "archived";
export const CONTACT_STATUSES: ContactStatus[] = ["new", "researched", "drafted", "contacted", "replied", "archived"];

export type ContactRow = {
  id: string;
  name: string;
  email: string | null;
  company_id: string | null;
  title: string | null;
  source: string | null;
  status: ContactStatus;
  notes: string | null;
  created_at: number;
  updated_at: number;
};

export type ContactRowWithCompany = ContactRow & { company_name: string | null };

export type CreateContactInput = {
  name: string;
  email?: string | null;
  companyId?: string | null;
  title?: string | null;
  source?: string | null;
  status?: ContactStatus;
  notes?: string | null;
};

export type UpdateContactInput = Partial<Omit<CreateContactInput, "name">> & { name?: string };

export type ListContactFilter = {
  statuses?: ContactStatus[];
  companyId?: string;
};

// ---------------------------------------------------------------------------
// Sync helpers
// ---------------------------------------------------------------------------

export function createContact(input: CreateContactInput): ContactRow {
  const db = getDb();
  const id = uuid();
  db.prepare(
    `INSERT INTO contacts (id, name, email, company_id, title, source, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.name,
    input.email ?? null,
    input.companyId ?? null,
    input.title ?? null,
    input.source ?? null,
    input.status ?? "new",
    input.notes ?? null,
  );
  return getContactById(id)!;
}

export function getContactById(id: string): ContactRow | null {
  const db = getDb();
  return (db.prepare(`SELECT * FROM contacts WHERE id = ?`).get(id) as ContactRow | undefined) ?? null;
}

export function listContacts(filter: ListContactFilter = {}): ContactRowWithCompany[] {
  const db = getDb();
  const where: string[] = [];
  const values: (string | number)[] = [];
  if (filter.statuses && filter.statuses.length > 0) {
    where.push(`c.status IN (${filter.statuses.map(() => "?").join(", ")})`);
    values.push(...filter.statuses);
  }
  if (filter.companyId) { where.push(`c.company_id = ?`); values.push(filter.companyId); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return db.prepare(`
    SELECT c.*, co.name AS company_name
    FROM contacts c
    LEFT JOIN companies co ON co.id = c.company_id
    ${whereSql}
    ORDER BY c.updated_at DESC
  `).all(...values) as ContactRowWithCompany[];
}

export function updateContact(id: string, input: UpdateContactInput): ContactRow | null {
  const db = getDb();
  const fields: string[] = [];
  const values: (string | null)[] = [];
  if (input.name !== undefined) { fields.push("name = ?"); values.push(input.name); }
  if (input.email !== undefined) { fields.push("email = ?"); values.push(input.email); }
  if (input.companyId !== undefined) { fields.push("company_id = ?"); values.push(input.companyId); }
  if (input.title !== undefined) { fields.push("title = ?"); values.push(input.title); }
  if (input.source !== undefined) { fields.push("source = ?"); values.push(input.source); }
  if (input.status !== undefined) { fields.push("status = ?"); values.push(input.status); }
  if (input.notes !== undefined) { fields.push("notes = ?"); values.push(input.notes); }
  if (fields.length === 0) return getContactById(id);
  fields.push("updated_at = unixepoch()");
  values.push(id);
  db.prepare(`UPDATE contacts SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getContactById(id);
}

export function deleteContact(id: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM contacts WHERE id = ?`).run(id);
}

// ---------------------------------------------------------------------------
// Async helpers
// ---------------------------------------------------------------------------

export async function createContactAsync(input: CreateContactInput): Promise<ContactRow> {
  const db = await getDbAsync();
  const id = uuid();
  await db.run(
    `INSERT INTO contacts (id, name, email, company_id, title, source, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.name,
      input.email ?? null,
      input.companyId ?? null,
      input.title ?? null,
      input.source ?? null,
      input.status ?? "new",
      input.notes ?? null,
    ],
  );
  return (await getContactByIdAsync(id))!;
}

export async function getContactByIdAsync(id: string): Promise<ContactRow | null> {
  const db = await getDbAsync();
  const row = await db.get<ContactRow>(`SELECT * FROM contacts WHERE id = ?`, [id]);
  return row ?? null;
}

export async function listContactsAsync(filter: ListContactFilter = {}): Promise<ContactRowWithCompany[]> {
  const db = await getDbAsync();
  const where: string[] = [];
  const values: (string | number)[] = [];
  if (filter.statuses && filter.statuses.length > 0) {
    where.push(`c.status IN (${filter.statuses.map(() => "?").join(", ")})`);
    values.push(...filter.statuses);
  }
  if (filter.companyId) { where.push(`c.company_id = ?`); values.push(filter.companyId); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return db.all<ContactRowWithCompany>(
    `SELECT c.*, co.name AS company_name
     FROM contacts c
     LEFT JOIN companies co ON co.id = c.company_id
     ${whereSql}
     ORDER BY c.updated_at DESC`,
    values,
  );
}

export async function updateContactAsync(id: string, input: UpdateContactInput): Promise<ContactRow | null> {
  const db = await getDbAsync();
  const fields: string[] = [];
  const values: (string | null)[] = [];
  if (input.name !== undefined) { fields.push("name = ?"); values.push(input.name); }
  if (input.email !== undefined) { fields.push("email = ?"); values.push(input.email); }
  if (input.companyId !== undefined) { fields.push("company_id = ?"); values.push(input.companyId); }
  if (input.title !== undefined) { fields.push("title = ?"); values.push(input.title); }
  if (input.source !== undefined) { fields.push("source = ?"); values.push(input.source); }
  if (input.status !== undefined) { fields.push("status = ?"); values.push(input.status); }
  if (input.notes !== undefined) { fields.push("notes = ?"); values.push(input.notes); }
  if (fields.length === 0) return getContactByIdAsync(id);
  fields.push(`updated_at = ${nowSql(db)}`);
  values.push(id);
  await db.run(`UPDATE contacts SET ${fields.join(", ")} WHERE id = ?`, values);
  return getContactByIdAsync(id);
}

export async function deleteContactAsync(id: string): Promise<void> {
  const db = await getDbAsync();
  await db.run(`DELETE FROM contacts WHERE id = ?`, [id]);
}

export async function countContactsByStatusAsync(statuses: ContactStatus[]): Promise<number> {
  if (statuses.length === 0) return 0;
  const db = await getDbAsync();
  const placeholders = statuses.map(() => "?").join(", ");
  const row = await db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM contacts WHERE status IN (${placeholders})`,
    statuses,
  );
  return Number(row?.n ?? 0);
}
