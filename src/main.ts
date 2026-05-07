import { loadConfig } from "./config";
import { getPool } from "./db/client";
import { runMigrations } from "./db/migrate";
import { createApp } from "./server/app";
import { startWorker } from "./worker";

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = getPool(config.databaseUrl);

  await runMigrations(pool);

  const boss = await startWorker(pool, config);
  const app = createApp(pool, boss, config);

  app.listen(config.port, () => {
    console.log(`SBOM service running on port ${config.port}`);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
