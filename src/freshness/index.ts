import { Pool } from "pg";
import PgBoss from "pg-boss";
import { loadWatchlist } from "./watchlistLoader";
import { fetchEndOfLifeCycles, findCycleForVersion } from "./endoflifeClient";
import { fetchNpmLatest } from "./registryAdapters/npm";
import { fetchMavenLatest } from "./registryAdapters/maven";
import { fetchPypiLatest } from "./registryAdapters/pypi";
import { evaluateWithEndOfLife, evaluateWithRegistry } from "./stateCalculator";
import { WatchlistPackage, FreshnessEvaluation, EndOfLifeCycle } from "./types";

export function registerFreshnessHandler(boss: PgBoss, pool: Pool): void {
  boss.work(
    "freshness-sync",
    { batchSize: 1 },
    async () => await runFreshnessSync(pool),
  );
  boss.schedule("freshness-sync", "0 3 * * *", {}, {});
}

export async function runFreshnessSync(pool: Pool): Promise<string> {
  const watchlist = loadWatchlist();
  console.log(
    `[freshness] Starting sync for ${watchlist.length} watchlist packages`,
  );

  const eolCache = new Map<string, EndOfLifeCycle[]>();
  const registryCache = new Map<string, { latest: string } | null>();

  for (const pkg of watchlist) {
    if (pkg.endoflife_product) {
      const cycles = await fetchEndOfLifeCycles(pkg.endoflife_product);
      eolCache.set(pkg.name, cycles);
    } else if (pkg.registry) {
      const info = await fetchLatestFromRegistry(pkg);
      registryCache.set(pkg.name, info ? { latest: info } : null);
    }
  }

  const services = await pool.query("SELECT id, name FROM services");
  let evaluatedCount = 0;

  for (const service of services.rows) {
    for (const pkg of watchlist) {
      const evaluation = await evaluateServicePackage(
        pool,
        service.id,
        pkg,
        eolCache,
        registryCache,
      );
      if (evaluation) {
        await upsertFreshnessIndicator(pool, service.id, evaluation);
        evaluatedCount++;
      }
    }
  }

  console.log(
    `[freshness] Sync complete: ${evaluatedCount} indicators updated`,
  );
  return `Freshness sync: ${evaluatedCount} indicators across ${services.rowCount} services`;
}

async function evaluateServicePackage(
  pool: Pool,
  serviceId: string,
  pkg: WatchlistPackage,
  eolCache: Map<string, EndOfLifeCycle[]>,
  registryCache: Map<string, { latest: string } | null>,
): Promise<FreshnessEvaluation | null> {
  const detectedVersion = await getLatestComponentVersion(
    pool,
    serviceId,
    pkg.match_component,
  );
  if (!detectedVersion) return null;

  const existingFirstBehindAt = await getExistingFirstBehindAt(
    pool,
    serviceId,
    pkg.name,
  );

  if (pkg.endoflife_product) {
    const cycles = eolCache.get(pkg.name) || [];
    if (cycles.length === 0) return null;

    const matchedCycle = detectedVersion
      ? findCycleForVersion(cycles, detectedVersion)
      : null;
    const latestCycle = cycles[0] || null;

    return evaluateWithEndOfLife(
      pkg.name,
      detectedVersion,
      matchedCycle,
      latestCycle,
      existingFirstBehindAt,
    );
  }

  if (pkg.registry) {
    const info = registryCache.get(pkg.name);
    return evaluateWithRegistry(
      pkg.name,
      detectedVersion,
      info?.latest || null,
      existingFirstBehindAt,
    );
  }

  return null;
}

async function fetchLatestFromRegistry(
  pkg: WatchlistPackage,
): Promise<string | null> {
  if (pkg.registry === "npmjs") {
    const info = await fetchNpmLatest(pkg.match_component);
    return info?.latest || null;
  }
  if (pkg.registry === "maven") {
    const info = await fetchMavenLatest(pkg.match_component);
    return info?.latest || null;
  }
  if (pkg.registry === "pypi") {
    const info = await fetchPypiLatest(pkg.match_component);
    return info?.latest || null;
  }
  return null;
}

async function getLatestComponentVersion(
  pool: Pool,
  serviceId: string,
  matchComponent: string,
): Promise<string | null> {
  const result = await pool.query(
    `SELECT c.version
     FROM sbom_components c
     JOIN sbom_records r ON r.id = c.sbom_record_id
     WHERE r.service_id = $1
       AND r.normalisation_status = 'complete'
       AND c.name = $2
     ORDER BY r.received_at DESC
     LIMIT 1`,
    [serviceId, matchComponent],
  );
  return result.rows[0]?.version || null;
}

async function getExistingFirstBehindAt(
  pool: Pool,
  serviceId: string,
  packageName: string,
): Promise<Date | null> {
  const result = await pool.query(
    "SELECT first_behind_at FROM sbom_freshness_indicators WHERE service_id = $1 AND package_name = $2",
    [serviceId, packageName],
  );
  return result.rows[0]?.first_behind_at || null;
}

async function upsertFreshnessIndicator(
  pool: Pool,
  serviceId: string,
  evaluation: FreshnessEvaluation,
): Promise<void> {
  await pool.query(
    `INSERT INTO sbom_freshness_indicators
       (service_id, package_name, detected_version, latest_version, versions_behind_major, versions_behind_minor, lts_status, eol_date, state, first_behind_at, evaluated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
     ON CONFLICT (service_id, package_name) DO UPDATE SET
       detected_version = EXCLUDED.detected_version,
       latest_version = EXCLUDED.latest_version,
       versions_behind_major = EXCLUDED.versions_behind_major,
       versions_behind_minor = EXCLUDED.versions_behind_minor,
       lts_status = EXCLUDED.lts_status,
       eol_date = EXCLUDED.eol_date,
       state = EXCLUDED.state,
       first_behind_at = EXCLUDED.first_behind_at,
       evaluated_at = EXCLUDED.evaluated_at`,
    [
      serviceId,
      evaluation.packageName,
      evaluation.detectedVersion,
      evaluation.latestVersion,
      evaluation.versionsBehindMajor,
      evaluation.versionsBehindMinor,
      evaluation.ltsStatus,
      evaluation.eolDate,
      evaluation.state,
      evaluation.firstBehindAt,
    ],
  );
}
