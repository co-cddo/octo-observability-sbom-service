import crypto from "crypto";
import { Pool } from "pg";
import { hashApiKey } from "../src/ingest/apiKeyAuth";

async function main(): Promise<void> {
  const serviceName = process.argv[2];
  const label = process.argv[3] || "default";
  const createdBy = process.argv[4] || "cli";

  if (!serviceName) {
    console.error(
      "Usage: ts-node scripts/generate-api-key.ts <service_name> [label] [created_by]",
    );
    console.error(
      "  Creates the service if it doesn't exist, then generates an API key.",
    );
    process.exit(1);
  }

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

  const slug = serviceName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const existing = await pool.query("SELECT id FROM services WHERE slug = $1", [
    slug,
  ]);

  let serviceId: string;
  if (existing.rowCount && existing.rowCount > 0) {
    serviceId = existing.rows[0].id;
    console.log(`Found existing service: ${serviceId}`);
  } else {
    const inserted = await pool.query(
      "INSERT INTO services (name, slug, organisation) VALUES ($1, $2, $3) RETURNING id",
      [serviceName, slug, "Unknown"],
    );
    serviceId = inserted.rows[0].id;
    console.log(`Created service: ${serviceId}`);
  }

  const rawKey = `sbom_${crypto.randomBytes(32).toString("hex")}`;
  const keyHash = hashApiKey(rawKey);
  const keyPrefix = rawKey.substring(0, 8);

  await pool.query(
    `INSERT INTO sbom_api_keys (service_id, key_hash, key_prefix, label, created_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [serviceId, keyHash, keyPrefix, label, createdBy],
  );

  console.log("\n=== API Key Generated ===");
  console.log(`Service:    ${serviceName} (${serviceId})`);
  console.log(`Label:      ${label}`);
  console.log(`Key:        ${rawKey}`);
  console.log("\nStore this key securely — it cannot be retrieved again.\n");

  await pool.end();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
