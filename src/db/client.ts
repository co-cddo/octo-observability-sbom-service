import { Pool } from "pg";

let pool: Pool | null = null;
let readOnlyPool: Pool | null = null;

export function getPool(databaseUrl: string): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: databaseUrl,
      max: 10,
      ssl:
        process.env.NODE_ENV === "production"
          ? { rejectUnauthorized: false }
          : undefined,
    });
  }
  return pool;
}

export function getReadOnlyPool(databaseUrl: string): Pool {
  if (!readOnlyPool) {
    readOnlyPool = new Pool({
      connectionString: databaseUrl,
      max: 3,
      ssl:
        process.env.NODE_ENV === "production"
          ? { rejectUnauthorized: false }
          : undefined,
      options: "-c statement_timeout=30000 -c default_transaction_read_only=on",
    });
  }
  return readOnlyPool;
}

export async function closePools(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
  if (readOnlyPool) {
    await readOnlyPool.end();
    readOnlyPool = null;
  }
}
