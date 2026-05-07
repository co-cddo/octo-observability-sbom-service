import fs from "fs";
import path from "path";
import { Pool } from "pg";

const MIGRATIONS_DIR = path.join(__dirname, "migrations");

async function ensureMigrationsTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedVersions(pool: Pool): Promise<Set<number>> {
  const result = await pool.query(
    "SELECT version FROM schema_migrations ORDER BY version",
  );
  return new Set(result.rows.map((r) => r.version));
}

function getMigrationFiles(): { version: number; filename: string }[] {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"));
  return files
    .map((filename) => {
      const version = parseInt(filename.split("_")[0], 10);
      return { version, filename };
    })
    .sort((a, b) => a.version - b.version);
}

export async function runMigrations(pool: Pool): Promise<void> {
  await ensureMigrationsTable(pool);
  const applied = await getAppliedVersions(pool);
  const migrations = getMigrationFiles();

  for (const { version, filename } of migrations) {
    if (applied.has(version)) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), "utf-8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (version) VALUES ($1)",
        [version],
      );
      await client.query("COMMIT");
      console.log(`Applied migration ${filename}`);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`Failed migration ${filename}:`, err);
      throw err;
    } finally {
      client.release();
    }
  }
}

if (require.main === module) {
  const databaseUrl =
    process.env.DATABASE_URL ||
    (() => {
      const host = process.env.DATABASE_HOST || "localhost";
      const port = process.env.DATABASE_PORT || "5432";
      const user = process.env.DATABASE_USER || "sbom";
      const password = process.env.DATABASE_PASSWORD || "sbom";
      const name = process.env.DATABASE_NAME || "sbom_service";
      return `postgres://${user}:${password}@${host}:${port}/${name}`;
    })();

  const pool = new Pool({ connectionString: databaseUrl });
  runMigrations(pool)
    .then(() => {
      console.log("Migrations complete");
      process.exit(0);
    })
    .catch((err) => {
      console.error("Migration failed:", err);
      process.exit(1);
    });
}
