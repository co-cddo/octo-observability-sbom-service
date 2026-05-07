import { Pool } from "pg";
import semver from "semver";
import {
  upsertVulnerability,
  updateVulnerabilityIndicator,
  getLatestSbomForService,
} from "../db/queries";

interface MatchResult {
  service_id: string;
  sbom_record_id: string;
  vuln_id: string;
  ecosystem: string;
  package_name: string;
  affected_version: string;
  fixed: string | null;
  severity: string;
  cvss_score: number | null;
}

export async function runMatcher(pool: Pool, since?: Date): Promise<number> {
  const sinceFilter = since ? "AND ov.modified > $1" : "";
  const params: unknown[] = since ? [since.toISOString()] : [];

  const enumMatches = await pool.query<MatchResult>(
    `SELECT DISTINCT
       sr.service_id,
       sc.sbom_record_id,
       oap.vuln_id,
       oap.ecosystem,
       oap.package_name,
       sc.version AS affected_version,
       oap.fixed,
       ov.severity,
       ov.cvss_score
     FROM osv_affected_packages oap
     JOIN sbom_components sc
       ON sc.ecosystem = oap.ecosystem
       AND sc.name = oap.package_name
       AND sc.version = ANY(oap.vulnerable_versions)
     JOIN sbom_records sr ON sr.id = sc.sbom_record_id
     JOIN osv_vulnerabilities ov ON ov.id = oap.vuln_id
     WHERE sr.id IN (
       SELECT DISTINCT ON (service_id) id
       FROM sbom_records
       WHERE normalisation_status = 'complete'
       ORDER BY service_id, received_at DESC
     )
     AND ov.withdrawn IS NULL
     ${sinceFilter}`,
    params,
  );

  const rangeMatches = await pool.query<
    MatchResult & { introduced: string | null }
  >(
    `SELECT DISTINCT
       sr.service_id,
       sc.sbom_record_id,
       oap.vuln_id,
       oap.ecosystem,
       oap.package_name,
       sc.version AS affected_version,
       oap.introduced,
       oap.fixed,
       ov.severity,
       ov.cvss_score
     FROM osv_affected_packages oap
     JOIN sbom_components sc
       ON sc.ecosystem = oap.ecosystem
       AND sc.name = oap.package_name
     JOIN sbom_records sr ON sr.id = sc.sbom_record_id
     JOIN osv_vulnerabilities ov ON ov.id = oap.vuln_id
     WHERE sr.id IN (
       SELECT DISTINCT ON (service_id) id
       FROM sbom_records
       WHERE normalisation_status = 'complete'
       ORDER BY service_id, received_at DESC
     )
     AND ov.withdrawn IS NULL
     AND oap.fixed IS NOT NULL
     AND (oap.vulnerable_versions IS NULL OR array_length(oap.vulnerable_versions, 1) IS NULL)
     ${sinceFilter}`,
    params,
  );

  const semverMatches = rangeMatches.rows.filter((row) => {
    const version = row.affected_version;
    if (!semver.valid(version)) return false;
    if (row.introduced && semver.valid(row.introduced)) {
      if (semver.lt(version, row.introduced)) return false;
    }
    if (row.fixed && semver.valid(row.fixed)) {
      if (semver.gte(version, row.fixed)) return false;
    }
    return true;
  });

  const allMatches = [...enumMatches.rows, ...semverMatches];
  const affectedServices = new Set<string>();

  for (const match of allMatches) {
    await upsertVulnerability(pool, {
      serviceId: match.service_id,
      cveId: match.vuln_id,
      severity: match.severity || "unknown",
      cvssScore: match.cvss_score,
      affectedPackage: match.package_name,
      affectedVersion: match.affected_version,
      fixedVersion: match.fixed,
      ecosystem: match.ecosystem,
    });
    affectedServices.add(match.service_id);
  }

  for (const serviceId of affectedServices) {
    const sbomId = await getLatestSbomForService(pool, serviceId);
    if (sbomId) {
      await updateVulnerabilityIndicator(pool, serviceId, sbomId);
    }
  }

  return allMatches.length;
}
