import { Pool } from "pg";
import { OsvVulnerability } from "../types";
import {
  getOpenVulnerabilities,
  upsertVulnerability,
  resolveVulnerabilities,
} from "../db/queries";

export async function trackVulnerabilityLifecycle(
  pool: Pool,
  serviceId: string,
  currentVulns: OsvVulnerability[],
): Promise<void> {
  const previouslyOpen = await getOpenVulnerabilities(pool, serviceId);

  for (const vuln of currentVulns) {
    await upsertVulnerability(pool, {
      serviceId,
      cveId: vuln.id,
      severity: vuln.severity,
      cvssScore: vuln.cvssScore,
      affectedPackage: vuln.affectedPackage,
      affectedVersion: vuln.affectedVersion,
      fixedVersion: vuln.fixedVersion,
      ecosystem: vuln.ecosystem,
    });
  }

  const stillOpenPairs = currentVulns.map((v) => ({
    cve_id: v.id,
    affected_package: v.affectedPackage,
  }));

  if (previouslyOpen.length > 0) {
    await resolveVulnerabilities(pool, serviceId, stillOpenPairs);
  }
}
