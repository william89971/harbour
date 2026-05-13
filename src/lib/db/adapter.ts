// Database adapter interface — abstraction over SQLite (better-sqlite3) and
// Postgres (pg). Every DB module talks through this interface so the same
// codebase runs against either backend.
//
// The backend is selected at startup by DATABASE_URL: unset → SQLite (default),
// postgres://... or postgresql://... → Postgres. See src/lib/db/schema.ts.

export type SqlParam = string | number | boolean | null | Buffer | Date | bigint;

export type RunResult = {
  changes: number;
  /** SQLite returns the rowid of the last INSERT; Postgres leaves this undefined. */
  lastInsertRowid?: number | bigint;
};

export interface DbAdapter {
  /** Run an INSERT / UPDATE / DELETE / DDL statement. */
  run(sql: string, params?: SqlParam[]): Promise<RunResult>;
  /** Read a single row. Returns null when no match. */
  get<T = Record<string, unknown>>(sql: string, params?: SqlParam[]): Promise<T | null>;
  /** Read multiple rows. */
  all<T = Record<string, unknown>>(sql: string, params?: SqlParam[]): Promise<T[]>;
  /** Run multiple statements (DDL) — no placeholders, no return value. */
  exec(sql: string): Promise<void>;
  /** Atomic block. Callback receives a transaction-scoped adapter that shares
   *  the underlying connection / lock. Throwing rolls back. */
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
  /** Dialect tag — used by the few call sites that need conditional SQL
   *  (notably the polling claim path's FOR UPDATE SKIP LOCKED on PG). */
  readonly dialect: "sqlite" | "postgres";
  /** Best-effort shutdown for tests and graceful exits. */
  close(): Promise<void>;
}
