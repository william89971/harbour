import type { DbAdapter } from "./adapter";

/** SQL expression for the current Unix epoch in seconds, dialect-aware. */
export function nowSql(db: DbAdapter): string {
  return db.dialect === "postgres"
    ? "(extract(epoch from now())::bigint)"
    : "unixepoch()";
}

/** Suffix to append to a SELECT to lock the row for the duration of the
 *  enclosing transaction, skipping rows already locked by another transaction.
 *  No-op on SQLite (the database-level write lock handles atomicity). */
export function forUpdateSkipLocked(db: DbAdapter): string {
  return db.dialect === "postgres" ? " FOR UPDATE SKIP LOCKED" : "";
}
