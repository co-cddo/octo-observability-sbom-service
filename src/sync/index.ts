import { Pool } from "pg";
import PgBoss from "pg-boss";
import { unlink } from "fs/promises";
import * as unzipper from "unzipper";
import {
  SUPPORTED_ECOSYSTEMS,
  downloadEcosystemZip,
  fetchModifiedIds,
  fetchVulnJson,
} from "./osvDownloader";
import { parseOsvRecord, ParsedVuln } from "./osvParser";
import { runMatcher } from "./matcher";

export function registerSyncHandler(boss: PgBoss, pool: Pool): void {
  boss.work("osv-sync", { batchSize: 1 }, async () => await runSync(pool));
  boss.schedule("osv-sync", "0 */6 * * *", {}, {});
}

export async function runSync(pool: Pool): Promise<string> {
  let totalSynced = 0;

  for (const ecosystem of SUPPORTED_ECOSYSTEMS) {
    const synced = await syncEcosystem(pool, ecosystem);
    totalSynced += synced;
  }

  const matchCount = await runMatcher(pool);
  return `Synced ${totalSynced} vulns across ${SUPPORTED_ECOSYSTEMS.length} ecosystems. ${matchCount} new matches found.`;
}

async function syncEcosystem(pool: Pool, ecosystem: string): Promise<number> {
  const stateResult = await pool.query(
    "SELECT last_synced_at FROM osv_sync_state WHERE ecosystem = $1",
    [ecosystem],
  );

  const lastSynced = stateResult.rows[0]?.last_synced_at
    ? new Date(stateResult.rows[0].last_synced_at)
    : null;

  let count: number;

  if (!lastSynced) {
    count = await initialSync(pool, ecosystem);
  } else {
    count = await incrementalSync(pool, ecosystem, lastSynced);
  }

  const totalResult = await pool.query(
    "SELECT COUNT(DISTINCT vuln_id)::int AS total FROM osv_affected_packages WHERE ecosystem = $1",
    [ecosystem],
  );
  const totalCount = totalResult.rows[0]?.total || 0;

  await pool.query(
    `INSERT INTO osv_sync_state (ecosystem, last_synced_at, vuln_count)
     VALUES ($1, NOW(), $2)
     ON CONFLICT (ecosystem) DO UPDATE SET last_synced_at = NOW(), vuln_count = EXCLUDED.vuln_count`,
    [ecosystem, totalCount],
  );

  console.log(`[osv-sync] ${ecosystem}: synced ${count} vulnerabilities`);
  return count;
}

async function initialSync(pool: Pool, ecosystem: string): Promise<number> {
  console.log(`[osv-sync] ${ecosystem}: initial sync (downloading all.zip)...`);
  const zipPath = await downloadEcosystemZip(ecosystem);
  const { stat } = await import("fs/promises");
  const fileSize = (await stat(zipPath)).size;
  console.log(
    `[osv-sync] ${ecosystem}: downloaded ${(fileSize / 1024 / 1024).toFixed(1)}MB to ${zipPath}`,
  );

  const directory = await unzipper.Open.file(zipPath);
  console.log(
    `[osv-sync] ${ecosystem}: ${directory.files.length} files in zip`,
  );

  let count = 0;
  const batch: ParsedVuln[] = [];

  for (const file of directory.files) {
    if (!file.path.endsWith(".json")) continue;

    const buffer = await file.buffer();
    const json = JSON.parse(buffer.toString("utf-8"));
    const parsed = parseOsvRecord(json);
    if (parsed) {
      batch.push(parsed);
      if (batch.length >= 100) {
        await upsertVulnBatch(pool, batch);
        count += batch.length;
        batch.length = 0;
        if (count % 5000 === 0)
          console.log(`[osv-sync] ${ecosystem}: ${count} processed...`);
      }
    }
  }

  if (batch.length > 0) {
    await upsertVulnBatch(pool, batch);
    count += batch.length;
  }

  await unlink(zipPath).catch(() => {});
  return count;
}

async function incrementalSync(
  pool: Pool,
  ecosystem: string,
  since: Date,
): Promise<number> {
  console.log(
    `[osv-sync] ${ecosystem}: incremental sync since ${since.toISOString()}...`,
  );
  const modified = await fetchModifiedIds(ecosystem, since);

  let count = 0;
  for (const entry of modified) {
    const json = await fetchVulnJson(ecosystem, entry.id);
    if (!json) continue;

    const parsed = parseOsvRecord(json);
    if (parsed) {
      await upsertVulnBatch(pool, [parsed]);
      count++;
    }
  }

  return count;
}

async function upsertVulnBatch(pool: Pool, vulns: ParsedVuln[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const vuln of vulns) {
      await upsertVulnSingle(client, vuln);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function upsertVulnSingle(
  client: { query(text: string, values?: unknown[]): Promise<unknown> },
  vuln: ParsedVuln,
): Promise<void> {
  await client.query(
    `INSERT INTO osv_vulnerabilities (id, summary, severity, cvss_score, published, modified, withdrawn, synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (id) DO UPDATE SET
       summary = EXCLUDED.summary,
       severity = EXCLUDED.severity,
       cvss_score = EXCLUDED.cvss_score,
       modified = EXCLUDED.modified,
       withdrawn = EXCLUDED.withdrawn,
       synced_at = NOW()`,
    [
      vuln.id,
      vuln.summary,
      vuln.severity,
      vuln.cvssScore,
      vuln.published,
      vuln.modified,
      vuln.withdrawn,
    ],
  );

  await client.query("DELETE FROM osv_affected_packages WHERE vuln_id = $1", [
    vuln.id,
  ]);

  for (const pkg of vuln.affectedPackages) {
    await client.query(
      `INSERT INTO osv_affected_packages (vuln_id, ecosystem, package_name, introduced, fixed, vulnerable_versions)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        vuln.id,
        pkg.ecosystem,
        pkg.packageName,
        pkg.introduced,
        pkg.fixed,
        pkg.vulnerableVersions.length > 0 ? pkg.vulnerableVersions : null,
      ],
    );
  }
}
