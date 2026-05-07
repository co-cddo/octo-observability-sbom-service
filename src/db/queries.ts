import { Pool } from "pg";

export interface ApiKeyRow {
  id: string;
  service_id: string;
  key_hash: string;
  key_prefix: string;
  label: string;
}

export interface SbomRecord {
  id: string;
  service_id: string;
  s3_key: string;
  format: string;
  format_version: string | null;
  component_count: number;
  received_at: Date;
  submitted_by: string;
  normalisation_status: string;
}

export interface VulnerabilityRow {
  id: string;
  service_id: string;
  cve_id: string;
  severity: string;
  cvss_score: number | null;
  affected_package: string;
  affected_version: string;
  fixed_version: string | null;
  ecosystem: string;
  first_seen_at: Date;
  resolved_at: Date | null;
}

export async function findActiveApiKeyByPrefix(
  pool: Pool,
  prefix: string,
): Promise<ApiKeyRow | null> {
  const result = await pool.query(
    `SELECT id, service_id, key_hash, key_prefix, label
     FROM sbom_api_keys
     WHERE key_prefix = $1 AND revoked_at IS NULL
     LIMIT 1`,
    [prefix],
  );
  return result.rows[0] || null;
}

export async function updateApiKeyLastUsed(
  pool: Pool,
  keyId: string,
): Promise<void> {
  await pool.query(
    "UPDATE sbom_api_keys SET last_used_at = NOW() WHERE id = $1",
    [keyId],
  );
}

export async function serviceExists(
  pool: Pool,
  serviceId: string,
): Promise<boolean> {
  const result = await pool.query("SELECT 1 FROM services WHERE id = $1", [
    serviceId,
  ]);
  return result.rowCount !== null && result.rowCount > 0;
}

export async function insertSbomRecord(
  pool: Pool,
  record: {
    serviceId: string;
    s3Key: string;
    format: string;
    formatVersion: string | null;
    receivedAt: Date;
    submittedBy: string;
  },
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO sbom_records (service_id, s3_key, format, format_version, received_at, submitted_by, normalisation_status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')
     RETURNING id`,
    [
      record.serviceId,
      record.s3Key,
      record.format,
      record.formatVersion,
      record.receivedAt,
      record.submittedBy,
    ],
  );
  return result.rows[0].id;
}

export async function updateSbomRecordStatus(
  pool: Pool,
  recordId: string,
  status: "complete" | "failed",
  componentCount: number,
  errorMessage?: string,
): Promise<void> {
  await pool.query(
    `UPDATE sbom_records
     SET normalisation_status = $2, component_count = $3, error_message = $4
     WHERE id = $1`,
    [recordId, status, componentCount, errorMessage || null],
  );
}

export async function insertComponents(
  pool: Pool,
  sbomRecordId: string,
  components: {
    name: string;
    version: string;
    ecosystem: string;
    purl: string | null;
    license: string | null;
  }[],
): Promise<void> {
  if (components.length === 0) return;

  const values: unknown[] = [];
  const placeholders: string[] = [];
  let idx = 1;

  for (const c of components) {
    placeholders.push(
      `($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5})`,
    );
    values.push(
      sbomRecordId,
      c.name,
      c.version,
      c.ecosystem,
      c.purl,
      c.license,
    );
    idx += 6;
  }

  await pool.query(
    `INSERT INTO sbom_components (sbom_record_id, name, version, ecosystem, purl, license)
     VALUES ${placeholders.join(", ")}`,
    values,
  );
}

export async function getComponentsForSbom(
  pool: Pool,
  sbomRecordId: string,
): Promise<
  { name: string; version: string; ecosystem: string; purl: string | null }[]
> {
  const result = await pool.query(
    "SELECT name, version, ecosystem, purl FROM sbom_components WHERE sbom_record_id = $1",
    [sbomRecordId],
  );
  return result.rows;
}

export async function getOpenVulnerabilities(
  pool: Pool,
  serviceId: string,
): Promise<{ cve_id: string; affected_package: string }[]> {
  const result = await pool.query(
    "SELECT cve_id, affected_package FROM sbom_vulnerabilities WHERE service_id = $1 AND resolved_at IS NULL",
    [serviceId],
  );
  return result.rows;
}

export async function upsertVulnerability(
  pool: Pool,
  vuln: {
    serviceId: string;
    cveId: string;
    severity: string;
    cvssScore: number | null;
    affectedPackage: string;
    affectedVersion: string;
    fixedVersion: string | null;
    ecosystem: string;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO sbom_vulnerabilities (service_id, cve_id, severity, cvss_score, affected_package, affected_version, fixed_version, ecosystem)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (service_id, cve_id, affected_package)
     DO UPDATE SET
       severity = EXCLUDED.severity,
       cvss_score = EXCLUDED.cvss_score,
       affected_version = EXCLUDED.affected_version,
       fixed_version = EXCLUDED.fixed_version,
       resolved_at = NULL`,
    [
      vuln.serviceId,
      vuln.cveId,
      vuln.severity,
      vuln.cvssScore,
      vuln.affectedPackage,
      vuln.affectedVersion,
      vuln.fixedVersion,
      vuln.ecosystem,
    ],
  );
}

export async function resolveVulnerabilities(
  pool: Pool,
  serviceId: string,
  stillOpenCvePackagePairs: { cve_id: string; affected_package: string }[],
): Promise<void> {
  if (stillOpenCvePackagePairs.length === 0) {
    await pool.query(
      "UPDATE sbom_vulnerabilities SET resolved_at = NOW() WHERE service_id = $1 AND resolved_at IS NULL",
      [serviceId],
    );
    return;
  }

  const pairValues = stillOpenCvePackagePairs.map(
    (p) => `('${p.cve_id}', '${p.affected_package}')`,
  );
  await pool.query(
    `UPDATE sbom_vulnerabilities
     SET resolved_at = NOW()
     WHERE service_id = $1
       AND resolved_at IS NULL
       AND (cve_id, affected_package) NOT IN (${pairValues.join(", ")})`,
    [serviceId],
  );
}

export async function updateVulnerabilityIndicator(
  pool: Pool,
  serviceId: string,
  latestSbomId: string,
): Promise<void> {
  const counts = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE severity = 'critical') AS critical,
       COUNT(*) FILTER (WHERE severity = 'high') AS high,
       COUNT(*) FILTER (WHERE severity = 'medium') AS medium,
       COUNT(*) FILTER (WHERE severity = 'low') AS low
     FROM sbom_vulnerabilities
     WHERE service_id = $1 AND resolved_at IS NULL`,
    [serviceId],
  );

  const { critical, high, medium, low } = counts.rows[0];
  const state = critical > 0 ? "red" : high > 0 ? "amber" : "green";

  await pool.query(
    `INSERT INTO sbom_vulnerability_indicators (service_id, latest_sbom_id, state, critical_cve_count, high_cve_count, medium_cve_count, low_cve_count, last_scan_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
     ON CONFLICT (service_id) DO UPDATE SET
       latest_sbom_id = EXCLUDED.latest_sbom_id,
       state = EXCLUDED.state,
       critical_cve_count = EXCLUDED.critical_cve_count,
       high_cve_count = EXCLUDED.high_cve_count,
       medium_cve_count = EXCLUDED.medium_cve_count,
       low_cve_count = EXCLUDED.low_cve_count,
       last_scan_at = EXCLUDED.last_scan_at,
       updated_at = EXCLUDED.updated_at`,
    [serviceId, latestSbomId, state, critical, high, medium, low],
  );
}

export async function updateReleaseCadenceIndicator(
  pool: Pool,
  serviceId: string,
): Promise<void> {
  const result = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE received_at > NOW() - INTERVAL '30 days') AS count_30d,
       COUNT(*) FILTER (WHERE received_at > NOW() - INTERVAL '90 days') AS count_90d,
       MAX(received_at) AS last_release_at
     FROM sbom_records
     WHERE service_id = $1 AND normalisation_status = 'complete'`,
    [serviceId],
  );

  const { count_30d, count_90d, last_release_at } = result.rows[0];
  const daysSince = last_release_at
    ? Math.floor((Date.now() - new Date(last_release_at).getTime()) / 86400000)
    : null;

  const state =
    daysSince === null
      ? "unknown"
      : daysSince > 90
        ? "red"
        : daysSince > 30
          ? "amber"
          : "green";

  await pool.query(
    `INSERT INTO sbom_release_cadence_indicators (service_id, state, release_count_30d, release_count_90d, last_release_at, days_since_last_release, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (service_id) DO UPDATE SET
       state = EXCLUDED.state,
       release_count_30d = EXCLUDED.release_count_30d,
       release_count_90d = EXCLUDED.release_count_90d,
       last_release_at = EXCLUDED.last_release_at,
       days_since_last_release = EXCLUDED.days_since_last_release,
       updated_at = EXCLUDED.updated_at`,
    [serviceId, state, count_30d, count_90d, last_release_at, daysSince],
  );
}

export interface FreshnessIndicatorRow {
  package_name: string;
  detected_version: string | null;
  latest_version: string | null;
  versions_behind_major: number;
  lts_status: string;
  eol_date: Date | null;
  state: string;
  first_behind_at: Date | null;
  evaluated_at: Date;
}

export async function getDashboardData(pool: Pool): Promise<{
  services: {
    id: string;
    name: string;
    organisation: string;
    vuln_state: string | null;
    critical_cve_count: number;
    high_cve_count: number;
    medium_cve_count: number;
    last_scan_at: Date | null;
    cadence_state: string | null;
    release_count_30d: number;
    days_since_last_release: number | null;
    freshness_state: string | null;
    freshness_worst_package: string | null;
    freshness_worst_detail: string | null;
  }[];
}> {
  const result = await pool.query(
    `SELECT
       s.id, s.name, s.organisation,
       vi.state AS vuln_state,
       COALESCE(vi.critical_cve_count, 0) AS critical_cve_count,
       COALESCE(vi.high_cve_count, 0) AS high_cve_count,
       COALESCE(vi.medium_cve_count, 0) AS medium_cve_count,
       vi.last_scan_at,
       rc.state AS cadence_state,
       COALESCE(rc.release_count_30d, 0) AS release_count_30d,
       rc.days_since_last_release,
       fw.state AS freshness_state,
       fw.package_name AS freshness_worst_package,
       CASE
         WHEN fw.lts_status = 'eol' THEN 'EOL (' || fw.detected_version || ')'
         WHEN fw.lts_status = 'lts_ending' THEN 'LTS ending ' || fw.eol_date
         WHEN fw.versions_behind_major > 0 THEN fw.versions_behind_major || ' major behind'
         ELSE NULL
       END AS freshness_worst_detail
     FROM services s
     LEFT JOIN sbom_vulnerability_indicators vi ON vi.service_id = s.id
     LEFT JOIN sbom_release_cadence_indicators rc ON rc.service_id = s.id
     LEFT JOIN LATERAL (
       SELECT fi.state, fi.package_name, fi.lts_status, fi.eol_date, fi.detected_version, fi.versions_behind_major
       FROM sbom_freshness_indicators fi
       WHERE fi.service_id = s.id
       ORDER BY CASE fi.state WHEN 'red' THEN 0 WHEN 'amber' THEN 1 WHEN 'green' THEN 2 ELSE 3 END, fi.package_name
       LIMIT 1
     ) fw ON true
     ORDER BY vi.critical_cve_count DESC NULLS LAST, s.name`,
  );
  return { services: result.rows };
}

export async function getFreshnessForService(
  pool: Pool,
  serviceId: string,
): Promise<FreshnessIndicatorRow[]> {
  const result = await pool.query(
    `SELECT package_name, detected_version, latest_version, versions_behind_major,
            lts_status, eol_date, state, first_behind_at, evaluated_at
     FROM sbom_freshness_indicators
     WHERE service_id = $1 AND detected_version IS NOT NULL
     ORDER BY CASE state WHEN 'red' THEN 0 WHEN 'amber' THEN 1 WHEN 'green' THEN 2 ELSE 3 END, package_name`,
    [serviceId],
  );
  return result.rows;
}

export async function getServiceDetail(
  pool: Pool,
  serviceId: string,
): Promise<{
  vulnerabilities: VulnerabilityRow[];
  timeToPatch: {
    mean_days: number;
    median_days: number;
    p95_days: number;
  } | null;
  recentSboms: SbomRecord[];
}> {
  const vulns = await pool.query(
    `SELECT * FROM sbom_vulnerabilities
     WHERE service_id = $1 AND resolved_at IS NULL
     ORDER BY cvss_score DESC NULLS LAST`,
    [serviceId],
  );

  const ttp = await pool.query(
    `SELECT
       AVG(EXTRACT(EPOCH FROM (resolved_at - first_seen_at)) / 86400)::numeric(10,1) AS mean_days,
       (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (resolved_at - first_seen_at)) / 86400))::numeric(10,1) AS median_days,
       (PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (resolved_at - first_seen_at)) / 86400))::numeric(10,1) AS p95_days
     FROM sbom_vulnerabilities
     WHERE service_id = $1 AND resolved_at IS NOT NULL`,
    [serviceId],
  );

  const sboms = await pool.query(
    `SELECT * FROM sbom_records
     WHERE service_id = $1
     ORDER BY received_at DESC
     LIMIT 10`,
    [serviceId],
  );

  return {
    vulnerabilities: vulns.rows,
    timeToPatch: ttp.rows[0]?.mean_days ? ttp.rows[0] : null,
    recentSboms: sboms.rows,
  };
}

// --- Admin queries ---

export interface ServiceRow {
  id: string;
  name: string;
  slug: string;
  organisation: string;
  created_at: Date;
}

export interface ApiKeyDetail {
  id: string;
  key_prefix: string;
  label: string;
  created_by: string;
  created_at: Date;
  revoked_at: Date | null;
  last_used_at: Date | null;
}

export async function getAllServices(pool: Pool): Promise<ServiceRow[]> {
  const result = await pool.query("SELECT * FROM services ORDER BY name");
  return result.rows;
}

export async function getServiceById(
  pool: Pool,
  id: string,
): Promise<ServiceRow | null> {
  const result = await pool.query("SELECT * FROM services WHERE id = $1", [id]);
  return result.rows[0] || null;
}

export async function createService(
  pool: Pool,
  name: string,
  slug: string,
  organisation: string,
): Promise<string> {
  const result = await pool.query(
    "INSERT INTO services (name, slug, organisation) VALUES ($1, $2, $3) RETURNING id",
    [name, slug, organisation],
  );
  return result.rows[0].id;
}

export async function updateService(
  pool: Pool,
  id: string,
  name: string,
  organisation: string,
): Promise<void> {
  await pool.query(
    "UPDATE services SET name = $2, organisation = $3 WHERE id = $1",
    [id, name, organisation],
  );
}

export async function getKeysForService(
  pool: Pool,
  serviceId: string,
): Promise<ApiKeyDetail[]> {
  const result = await pool.query(
    `SELECT id, key_prefix, label, created_by, created_at, revoked_at, last_used_at
     FROM sbom_api_keys
     WHERE service_id = $1
     ORDER BY created_at DESC`,
    [serviceId],
  );
  return result.rows;
}

export async function revokeApiKey(pool: Pool, keyId: string): Promise<void> {
  await pool.query(
    "UPDATE sbom_api_keys SET revoked_at = NOW() WHERE id = $1",
    [keyId],
  );
}

export async function insertApiKey(
  pool: Pool,
  serviceId: string,
  keyHash: string,
  keyPrefix: string,
  label: string,
  createdBy: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO sbom_api_keys (service_id, key_hash, key_prefix, label, created_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [serviceId, keyHash, keyPrefix, label, createdBy],
  );
}

export async function getRecentJobs(
  pool: Pool,
  limit: number,
): Promise<
  {
    id: string;
    name: string;
    display_name: string;
    state: string;
    created_on: Date;
    completed_on: Date | null;
    output: unknown;
  }[]
> {
  const result = await pool.query(
    `SELECT id, name,
       CASE WHEN name LIKE '__pgboss__%' THEN 'schedule: ' || (data->>'name')
            ELSE name
       END AS display_name,
       state, created_on, completed_on, output
     FROM pgboss.job
     ORDER BY created_on DESC
     LIMIT $1`,
    [limit],
  );
  return result.rows;
}

export async function getJobCounts(pool: Pool): Promise<{
  created: number;
  active: number;
  completed: number;
  failed: number;
}> {
  const result = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE state = 'created') AS created,
       COUNT(*) FILTER (WHERE state = 'active') AS active,
       COUNT(*) FILTER (WHERE state = 'completed') AS completed,
       COUNT(*) FILTER (WHERE state = 'failed') AS failed
     FROM pgboss.job`,
  );
  return result.rows[0];
}

export async function getLatestSbomForService(
  pool: Pool,
  serviceId: string,
): Promise<string | null> {
  const result = await pool.query(
    "SELECT id FROM sbom_records WHERE service_id = $1 AND normalisation_status = 'complete' ORDER BY received_at DESC LIMIT 1",
    [serviceId],
  );
  return result.rows[0]?.id || null;
}
