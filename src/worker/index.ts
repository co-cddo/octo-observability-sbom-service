import PgBoss from "pg-boss";
import { Pool } from "pg";
import { Config } from "../config";
import { registerNormaliseHandler } from "../normalise";
import { registerScanHandler } from "../scanner";
import { registerCadenceHandler } from "../cadence";
import { registerSyncHandler } from "../sync";
import { registerFreshnessHandler } from "../freshness";

export async function startWorker(pool: Pool, config: Config): Promise<PgBoss> {
  const boss = new PgBoss(config.databaseUrl);

  boss.on("error", (err) => {
    console.error("pg-boss error:", err);
  });

  await boss.start();

  await boss.createQueue("normalise-sbom");
  await boss.createQueue("scan-vulnerabilities");
  await boss.createQueue("update-cadence");
  await boss.createQueue("osv-sync");
  await boss.createQueue("freshness-sync");

  registerNormaliseHandler(boss, pool, config);
  registerScanHandler(boss, pool, config);
  registerCadenceHandler(boss, pool);
  registerSyncHandler(boss, pool);
  registerFreshnessHandler(boss, pool);

  console.log(
    "Worker started: normalise-sbom, scan-vulnerabilities, update-cadence, osv-sync, freshness-sync",
  );
  return boss;
}
