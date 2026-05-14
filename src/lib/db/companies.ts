import { getDb, getDbAsync } from "./schema";
import { nowSql } from "./dialect";
import { v4 as uuid } from "uuid";

export type CompanyStatus = "prospect" | "customer" | "partner" | "archived";
export const COMPANY_STATUSES: CompanyStatus[] = ["prospect", "customer", "partner", "archived"];

export type CompanyRow = {
  id: string;
  name: string;
  website: string | null;
  industry: string | null;
  status: CompanyStatus;
  notes: string | null;
  created_at: number;
  updated_at: number;
};

export type CreateCompanyInput = {
  name: string;
  website?: string | null;
  industry?: string | null;
  status?: CompanyStatus;
  notes?: string | null;
};

export type UpdateCompanyInput = Partial<Omit<CreateCompanyInput, "name">> & { name?: string };

// ---------------------------------------------------------------------------
// Sync helpers
// ---------------------------------------------------------------------------

export function createCompany(input: CreateCompanyInput): CompanyRow {
  const db = getDb();
  const id = uuid();
  db.prepare(
    `INSERT INTO companies (id, name, website, industry, status, notes) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.name,
    input.website ?? null,
    input.industry ?? null,
    input.status ?? "prospect",
    input.notes ?? null,
  );
  return getCompanyById(id)!;
}

export function getCompanyById(id: string): CompanyRow | null {
  const db = getDb();
  return (db.prepare(`SELECT * FROM companies WHERE id = ?`).get(id) as CompanyRow | undefined) ?? null;
}

export function listCompanies(status?: CompanyStatus): CompanyRow[] {
  const db = getDb();
  if (status) {
    return db.prepare(`SELECT * FROM companies WHERE status = ? ORDER BY updated_at DESC`).all(status) as CompanyRow[];
  }
  return db.prepare(`SELECT * FROM companies ORDER BY (status = 'prospect') DESC, updated_at DESC`).all() as CompanyRow[];
}

export function updateCompany(id: string, input: UpdateCompanyInput): CompanyRow | null {
  const db = getDb();
  const fields: string[] = [];
  const values: (string | null)[] = [];
  if (input.name !== undefined) { fields.push("name = ?"); values.push(input.name); }
  if (input.website !== undefined) { fields.push("website = ?"); values.push(input.website); }
  if (input.industry !== undefined) { fields.push("industry = ?"); values.push(input.industry); }
  if (input.status !== undefined) { fields.push("status = ?"); values.push(input.status); }
  if (input.notes !== undefined) { fields.push("notes = ?"); values.push(input.notes); }
  if (fields.length === 0) return getCompanyById(id);
  fields.push("updated_at = unixepoch()");
  values.push(id);
  db.prepare(`UPDATE companies SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getCompanyById(id);
}

export function deleteCompany(id: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM companies WHERE id = ?`).run(id);
}

// ---------------------------------------------------------------------------
// Async helpers
// ---------------------------------------------------------------------------

export async function createCompanyAsync(input: CreateCompanyInput): Promise<CompanyRow> {
  const db = await getDbAsync();
  const id = uuid();
  await db.run(
    `INSERT INTO companies (id, name, website, industry, status, notes) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, input.name, input.website ?? null, input.industry ?? null, input.status ?? "prospect", input.notes ?? null],
  );
  return (await getCompanyByIdAsync(id))!;
}

export async function getCompanyByIdAsync(id: string): Promise<CompanyRow | null> {
  const db = await getDbAsync();
  const row = await db.get<CompanyRow>(`SELECT * FROM companies WHERE id = ?`, [id]);
  return row ?? null;
}

export async function listCompaniesAsync(status?: CompanyStatus): Promise<CompanyRow[]> {
  const db = await getDbAsync();
  if (status) {
    return db.all<CompanyRow>(`SELECT * FROM companies WHERE status = ? ORDER BY updated_at DESC`, [status]);
  }
  return db.all<CompanyRow>(`SELECT * FROM companies ORDER BY (CASE WHEN status = 'prospect' THEN 0 ELSE 1 END), updated_at DESC`);
}

export async function updateCompanyAsync(id: string, input: UpdateCompanyInput): Promise<CompanyRow | null> {
  const db = await getDbAsync();
  const fields: string[] = [];
  const values: (string | null)[] = [];
  if (input.name !== undefined) { fields.push("name = ?"); values.push(input.name); }
  if (input.website !== undefined) { fields.push("website = ?"); values.push(input.website); }
  if (input.industry !== undefined) { fields.push("industry = ?"); values.push(input.industry); }
  if (input.status !== undefined) { fields.push("status = ?"); values.push(input.status); }
  if (input.notes !== undefined) { fields.push("notes = ?"); values.push(input.notes); }
  if (fields.length === 0) return getCompanyByIdAsync(id);
  fields.push(`updated_at = ${nowSql(db)}`);
  values.push(id);
  await db.run(`UPDATE companies SET ${fields.join(", ")} WHERE id = ?`, values);
  return getCompanyByIdAsync(id);
}

export async function deleteCompanyAsync(id: string): Promise<void> {
  const db = await getDbAsync();
  await db.run(`DELETE FROM companies WHERE id = ?`, [id]);
}

export async function countCompaniesAsync(status?: CompanyStatus): Promise<number> {
  const db = await getDbAsync();
  if (status) {
    const row = await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM companies WHERE status = ?`, [status]);
    return Number(row?.n ?? 0);
  }
  const row = await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM companies`);
  return Number(row?.n ?? 0);
}
