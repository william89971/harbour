import { Pool, types } from "pg";
import type { PoolClient, QueryResultRow } from "pg";
import type { DbAdapter, RunResult, SqlParam } from "./adapter";

// pg returns BIGINT as a string by default to avoid JS number precision issues.
// All our INTEGER timestamps fit easily inside Number.MAX_SAFE_INTEGER so we
// parse them eagerly — call sites expect plain `number` everywhere.
types.setTypeParser(types.builtins.INT8, (v) => (v == null ? null : parseInt(v, 10)));

/** Convert `?` placeholders to `$1, $2, …`. Our SQL never embeds `?` inside
 *  string literals, so a single-pass regex is safe. */
function rewriteSql(sql: string): string {
  let i = 0;
  // unixepoch() is SQLite-specific; map to Postgres equivalent.
  const translated = sql.replace(/\bunixepoch\(\)/g, "(extract(epoch from now())::bigint)");
  return translated.replace(/\?/g, () => `$${++i}`);
}

class PgRunner implements DbAdapter {
  readonly dialect = "postgres" as const;
  constructor(private readonly exec_: (sql: string, params: unknown[]) => Promise<{ rows: QueryResultRow[]; rowCount: number | null }>, private readonly poolForTx: Pool | null) {}

  async run(sql: string, params: SqlParam[] = []): Promise<RunResult> {
    const res = await this.exec_(rewriteSql(sql), params);
    return { changes: res.rowCount ?? 0 };
  }

  async get<T = Record<string, unknown>>(sql: string, params: SqlParam[] = []): Promise<T | null> {
    const res = await this.exec_(rewriteSql(sql), params);
    return (res.rows[0] as T) ?? null;
  }

  async all<T = Record<string, unknown>>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    const res = await this.exec_(rewriteSql(sql), params);
    return res.rows as T[];
  }

  async exec(sql: string): Promise<void> {
    // Translate without placeholder rewrite — DDL doesn't use `?`.
    const translated = sql.replace(/\bunixepoch\(\)/g, "(extract(epoch from now())::bigint)");
    await this.exec_(translated, []);
  }

  async transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T> {
    if (!this.poolForTx) {
      // Already inside a transaction (this is a tx-scoped runner). Just call
      // the callback with ourselves — nested begins aren't supported.
      return fn(this);
    }
    const client: PoolClient = await this.poolForTx.connect();
    const txRunner = new PgRunner(async (sql, params) => {
      const r = await client.query(sql, params);
      return { rows: r.rows, rowCount: r.rowCount };
    }, null);
    try {
      await client.query("BEGIN");
      const result = await fn(txRunner);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch { /* already rolled back */ }
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    // Pool close is handled by the owning PostgresAdapter; runners are views.
  }
}

export class PostgresAdapter extends PgRunner {
  constructor(private readonly pool: Pool) {
    super(async (sql, params) => {
      const r = await pool.query(sql, params);
      return { rows: r.rows, rowCount: r.rowCount };
    }, pool);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createPostgresAdapter(connectionString: string): PostgresAdapter {
  const pool = new Pool({ connectionString });
  return new PostgresAdapter(pool);
}
