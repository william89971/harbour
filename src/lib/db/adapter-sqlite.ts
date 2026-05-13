import Database from "better-sqlite3";
import type { DbAdapter, RunResult, SqlParam } from "./adapter";

/** Wraps a better-sqlite3 instance to satisfy the async DbAdapter contract.
 *  All operations execute synchronously under the hood and are wrapped in
 *  Promise.resolve(...) so call sites can await uniformly across backends. */
export class SqliteAdapter implements DbAdapter {
  readonly dialect = "sqlite" as const;
  private inTx = false;

  constructor(public readonly db: Database.Database) {}

  async run(sql: string, params: SqlParam[] = []): Promise<RunResult> {
    const stmt = this.db.prepare(sql);
    const info = stmt.run(...(params as unknown[] as readonly unknown[]));
    return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
  }

  async get<T = Record<string, unknown>>(sql: string, params: SqlParam[] = []): Promise<T | null> {
    const row = this.db.prepare(sql).get(...(params as unknown[] as readonly unknown[])) as T | undefined;
    return row ?? null;
  }

  async all<T = Record<string, unknown>>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...(params as unknown[] as readonly unknown[])) as T[];
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
    // Nested transaction support: SQLite has no real nesting; we just run the
    // callback inline since we're already holding the write lock.
    if (this.inTx) return fn(this);
    this.inTx = true;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = await fn(this);
      this.db.exec("COMMIT");
      this.inTx = false;
      return result;
    } catch (err) {
      try { this.db.exec("ROLLBACK"); } catch { /* already rolled back */ }
      this.inTx = false;
      throw err;
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

export function createSqliteAdapter(filePath: string): SqliteAdapter {
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return new SqliteAdapter(db);
}

/** Test helper: wrap an existing in-memory better-sqlite3 instance. */
export function wrapSqliteDb(db: Database.Database): SqliteAdapter {
  return new SqliteAdapter(db);
}
