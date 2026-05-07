import { Cvss4P0, Cvss3P1 } from "ae-cvss-calculator";
import { OsvVulnerability } from "../types";

const OSV_BATCH_SIZE = 1000;

interface OsvQuery {
  package: { ecosystem: string; name: string };
  version: string;
}

interface OsvResult {
  vulns?: {
    id: string;
    severity?: { type: string; score: string }[];
    affected?: {
      package?: { ecosystem?: string; name?: string };
      ranges?: { events?: { fixed?: string }[] }[];
    }[];
  }[];
}

export async function queryOsv(
  apiUrl: string,
  queries: { ecosystem: string; name: string; version: string }[],
): Promise<Map<string, OsvVulnerability[]>> {
  const results = new Map<string, OsvVulnerability[]>();

  const validQueries = queries.filter(
    (q) => mapEcosystemToOsv(q.ecosystem) !== null,
  );

  for (let i = 0; i < validQueries.length; i += OSV_BATCH_SIZE) {
    const batch = validQueries.slice(i, i + OSV_BATCH_SIZE);
    const osvQueries: OsvQuery[] = batch.map((q) => ({
      package: { ecosystem: mapEcosystemToOsv(q.ecosystem)!, name: q.name },
      version: q.version,
    }));

    const response = await fetch(`${apiUrl}/v1/querybatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queries: osvQueries }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        await sleep(5000);
        i -= OSV_BATCH_SIZE;
        continue;
      }
      throw new Error(
        `OSV.dev API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as { results: OsvResult[] };

    for (let j = 0; j < batch.length; j++) {
      const pkg = batch[j];
      const osvResult = data.results[j];
      if (!osvResult?.vulns?.length) continue;

      const pkgKey = `${pkg.ecosystem}:${pkg.name}@${pkg.version}`;
      const vulns: OsvVulnerability[] = [];

      for (const v of osvResult.vulns) {
        const full = await fetchVulnDetails(apiUrl, v.id);
        let { severity, cvssScore } = extractSeverity(full?.severity);
        console.log(
          `${v.id} database_specific:`,
          JSON.stringify(full?.database_specific),
        );

        if (severity === "unknown" && full?.database_specific) {
          const dbSev = full.database_specific.severity?.toUpperCase();
          if (dbSev === "CRITICAL") severity = "critical";
          else if (dbSev === "HIGH") severity = "high";
          else if (dbSev === "MODERATE" || dbSev === "MEDIUM")
            severity = "medium";
          else if (dbSev === "LOW") severity = "low";

          if (full.database_specific.cvss?.score) {
            cvssScore = full.database_specific.cvss.score;
          }
        }

        const fixedVersion = extractFixedVersion(full?.affected);
        vulns.push({
          id: v.id,
          severity,
          cvssScore,
          affectedPackage: pkg.name,
          affectedVersion: pkg.version,
          fixedVersion,
          ecosystem: pkg.ecosystem,
        });
      }
      results.set(pkgKey, vulns);
    }
  }

  return results;
}

interface FullVulnResponse {
  severity?: { type: string; score: string }[];
  affected?: {
    package?: { ecosystem?: string; name?: string };
    ranges?: { events?: { fixed?: string }[] }[];
  }[];
  database_specific?: { severity?: string; cvss?: { score?: number } };
}

async function fetchVulnDetails(
  apiUrl: string,
  vulnId: string,
): Promise<FullVulnResponse | null> {
  try {
    const response = await fetch(`${apiUrl}/v1/vulns/${vulnId}`);
    if (!response.ok) return null;
    return (await response.json()) as FullVulnResponse;
  } catch {
    return null;
  }
}

function extractSeverity(
  severityArr: { type: string; score: string }[] | undefined,
): { severity: OsvVulnerability["severity"]; cvssScore: number | null } {
  if (!severityArr || severityArr.length === 0) {
    return { severity: "unknown", cvssScore: null };
  }

  const cvss = severityArr.find((s) => s.type.startsWith("CVSS_V"));
  if (!cvss) return { severity: "unknown", cvssScore: null };

  const score = parseCvssScore(cvss.score);
  if (score === null) return { severity: "unknown", cvssScore: null };

  return { severity: classifySeverity(score), cvssScore: score };
}

function parseCvssScore(scoreStr: string): number | null {
  const direct = parseFloat(scoreStr);
  if (!isNaN(direct) && direct >= 0 && direct <= 10) return direct;

  try {
    if (scoreStr.startsWith("CVSS:4")) {
      return new Cvss4P0(scoreStr).calculateScores().overall;
    }
    if (scoreStr.startsWith("CVSS:3")) {
      return new Cvss3P1(scoreStr).calculateScores().overall;
    }
  } catch {
    return null;
  }

  return null;
}

function classifySeverity(score: number): OsvVulnerability["severity"] {
  if (score >= 9.0) return "critical";
  if (score >= 7.0) return "high";
  if (score >= 4.0) return "medium";
  return "low";
}

function extractFixedVersion(
  affected:
    | {
        package?: { ecosystem?: string; name?: string };
        ranges?: { events?: { fixed?: string }[] }[];
      }[]
    | undefined,
): string | null {
  if (!affected) return null;
  for (const a of affected) {
    if (!a.ranges) continue;
    for (const range of a.ranges) {
      if (!range.events) continue;
      for (const event of range.events) {
        if (event.fixed) return event.fixed;
      }
    }
  }
  return null;
}

const VALID_OSV_ECOSYSTEMS = new Set([
  "npm",
  "PyPI",
  "Go",
  "Maven",
  "RubyGems",
  "NuGet",
  "crates.io",
  "Packagist",
  "Hex",
  "Pub",
  "SwiftURL",
]);

function mapEcosystemToOsv(ecosystem: string): string | null {
  const mapping: Record<string, string> = {
    npm: "npm",
    PyPI: "PyPI",
    Go: "Go",
    Maven: "Maven",
    RubyGems: "RubyGems",
    NuGet: "NuGet",
    "crates.io": "crates.io",
    Packagist: "Packagist",
  };
  const mapped = mapping[ecosystem] || ecosystem;
  return VALID_OSV_ECOSYSTEMS.has(mapped) ? mapped : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
