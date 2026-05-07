import { Pool } from "pg";
import PgBoss from "pg-boss";
import semver from "semver";
import { Config } from "../config";
import {
  getComponentsForSbom,
  updateVulnerabilityIndicator,
  getServiceById,
} from "../db/queries";
import { trackVulnerabilityLifecycle } from "./lifecycleTracker";
import { OsvVulnerability } from "../types";

interface ScanJobData {
  recordId: string;
  serviceId: string;
}

export function registerScanHandler(
  boss: PgBoss,
  pool: Pool,
  _config: Config,
): void {
  boss.work<ScanJobData>(
    "scan-vulnerabilities",
    { batchSize: 1 },
    async (jobs) => {
      if (jobs.length !== 1)
        throw new Error(`Expected 1 job, got ${jobs.length}`);
      const job = jobs[0];
      const { recordId, serviceId } = job.data;

      const components = await getComponentsForSbom(pool, recordId);
      if (components.length === 0) {
        const service = await getServiceById(pool, serviceId);
        return `${service?.name || serviceId} - no components to scan`;
      }

      const allVulns = await queryLocalMirror(pool, recordId);

      await trackVulnerabilityLifecycle(pool, serviceId, allVulns);
      await updateVulnerabilityIndicator(pool, serviceId, recordId);

      const service = await getServiceById(pool, serviceId);
      console.log(
        `Scan complete for ${serviceId}: ${allVulns.length} vulnerabilities found`,
      );
      return `${service?.name || serviceId} - ${allVulns.length} vulnerabilities found`;
    },
  );
}

async function queryLocalMirror(
  pool: Pool,
  sbomRecordId: string,
): Promise<OsvVulnerability[]> {
  const enumMatches = await pool.query(
    `SELECT DISTINCT
       oap.vuln_id, oap.ecosystem, oap.package_name, sc.version,
       oap.fixed, ov.severity, ov.cvss_score
     FROM osv_affected_packages oap
     JOIN sbom_components sc
       ON sc.ecosystem = oap.ecosystem
       AND sc.name = oap.package_name
       AND sc.version = ANY(oap.vulnerable_versions)
     JOIN osv_vulnerabilities ov ON ov.id = oap.vuln_id
     WHERE sc.sbom_record_id = $1
       AND ov.withdrawn IS NULL`,
    [sbomRecordId],
  );

  const rangeMatches = await pool.query(
    `SELECT DISTINCT
       oap.vuln_id, oap.ecosystem, oap.package_name, sc.version,
       oap.introduced, oap.fixed, ov.severity, ov.cvss_score
     FROM osv_affected_packages oap
     JOIN sbom_components sc
       ON sc.ecosystem = oap.ecosystem
       AND sc.name = oap.package_name
     JOIN osv_vulnerabilities ov ON ov.id = oap.vuln_id
     WHERE sc.sbom_record_id = $1
       AND ov.withdrawn IS NULL
       AND oap.fixed IS NOT NULL
       AND (oap.vulnerable_versions IS NULL OR array_length(oap.vulnerable_versions, 1) IS NULL)`,
    [sbomRecordId],
  );

  const semverFiltered = rangeMatches.rows.filter((row) => {
    if (!semver.valid(row.version)) return false;
    if (
      row.introduced &&
      semver.valid(row.introduced) &&
      semver.lt(row.version, row.introduced)
    )
      return false;
    if (
      row.fixed &&
      semver.valid(row.fixed) &&
      semver.gte(row.version, row.fixed)
    )
      return false;
    return true;
  });

  const allRows = [...enumMatches.rows, ...semverFiltered];

  return allRows.map((row) => ({
    id: row.vuln_id,
    severity: row.severity || "unknown",
    cvssScore: row.cvss_score ? parseFloat(row.cvss_score) : null,
    affectedPackage: row.package_name,
    affectedVersion: row.version,
    fixedVersion: row.fixed || null,
    ecosystem: row.ecosystem,
  }));
}
