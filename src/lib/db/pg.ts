/**
 * Direct Postgres access for server-side jobs (import tool, scheduled sync).
 * Each job runs inside a single transaction: it either completes fully or changes nothing.
 * Never import this from browser code.
 */
import pg from "pg";

let pool: pg.Pool | null = null;

export function getPool(connectionString = process.env.DATABASE_URL): pg.Pool {
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");
  if (!pool) {
    pool = new pg.Pool({
      connectionString,
      max: 3,
      // Supabase requires TLS; local test databases do not.
      ssl: /localhost|127\.0\.0\.1|\/var\/tmp|host=\//.test(connectionString) ? undefined : { rejectUnauthorized: false },
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export type Db = pg.PoolClient | pg.Client;

/** Runs fn in a transaction. If commit is false (dry run) everything is rolled back. */
export async function withTransaction<T>(
  fn: (db: pg.PoolClient) => Promise<T>,
  opts: { commit: boolean; pool?: pg.Pool } = { commit: true },
): Promise<T> {
  const client = await (opts.pool ?? getPool()).connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query(opts.commit ? "commit" : "rollback");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
