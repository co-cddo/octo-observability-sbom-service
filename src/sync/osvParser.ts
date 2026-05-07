import { Cvss4P0, Cvss3P1 } from "ae-cvss-calculator";

export interface ParsedVuln {
  id: string;
  summary: string | null;
  severity: "critical" | "high" | "medium" | "low" | "unknown";
  cvssScore: number | null;
  published: string;
  modified: string;
  withdrawn: string | null;
  affectedPackages: {
    ecosystem: string;
    packageName: string;
    introduced: string | null;
    fixed: string | null;
    vulnerableVersions: string[];
  }[];
}

interface OsvRecord {
  id?: string;
  summary?: string;
  severity?: { type: string; score: string }[];
  published?: string;
  modified?: string;
  withdrawn?: string;
  database_specific?: { severity?: string; cvss?: { score?: number } };
  affected?: {
    package?: { ecosystem?: string; name?: string };
    ranges?: {
      type?: string;
      events?: { introduced?: string; fixed?: string }[];
    }[];
    versions?: string[];
  }[];
}

export function parseOsvRecord(raw: unknown): ParsedVuln | null {
  const record = raw as OsvRecord;
  if (!record.id || !record.modified) return null;

  const { severity, cvssScore } = extractSeverity(
    record.severity,
    record.database_specific,
  );

  const affectedPackages: ParsedVuln["affectedPackages"] = [];

  for (const affected of record.affected || []) {
    const ecosystem = mapEcosystem(affected.package?.ecosystem);
    const packageName = affected.package?.name;
    if (!ecosystem || !packageName) continue;

    let introduced: string | null = null;
    let fixed: string | null = null;

    for (const range of affected.ranges || []) {
      for (const event of range.events || []) {
        if (event.introduced && event.introduced !== "0")
          introduced = event.introduced;
        if (event.fixed) fixed = event.fixed;
      }
    }

    affectedPackages.push({
      ecosystem,
      packageName,
      introduced,
      fixed,
      vulnerableVersions: affected.versions || [],
    });
  }

  if (affectedPackages.length === 0) return null;

  return {
    id: record.id,
    summary: record.summary || null,
    severity,
    cvssScore,
    published: record.published || record.modified,
    modified: record.modified,
    withdrawn: record.withdrawn || null,
    affectedPackages,
  };
}

function extractSeverity(
  severityArr: { type: string; score: string }[] | undefined,
  dbSpecific: { severity?: string; cvss?: { score?: number } } | undefined,
): { severity: ParsedVuln["severity"]; cvssScore: number | null } {
  if (severityArr && severityArr.length > 0) {
    const cvss = severityArr.find((s) => s.type.startsWith("CVSS_V"));
    if (cvss) {
      const score = parseCvssVector(cvss.score);
      if (score !== null) {
        return { severity: classifyScore(score), cvssScore: score };
      }
    }
  }

  if (dbSpecific?.cvss?.score) {
    return {
      severity: classifyScore(dbSpecific.cvss.score),
      cvssScore: dbSpecific.cvss.score,
    };
  }

  if (dbSpecific?.severity) {
    const sev = dbSpecific.severity.toUpperCase();
    if (sev === "CRITICAL") return { severity: "critical", cvssScore: null };
    if (sev === "HIGH") return { severity: "high", cvssScore: null };
    if (sev === "MODERATE" || sev === "MEDIUM")
      return { severity: "medium", cvssScore: null };
    if (sev === "LOW") return { severity: "low", cvssScore: null };
  }

  return { severity: "unknown", cvssScore: null };
}

function parseCvssVector(scoreStr: string): number | null {
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

function classifyScore(score: number): ParsedVuln["severity"] {
  if (score >= 9.0) return "critical";
  if (score >= 7.0) return "high";
  if (score >= 4.0) return "medium";
  return "low";
}

function mapEcosystem(ecosystem: string | undefined): string | null {
  if (!ecosystem) return null;
  const mapping: Record<string, string> = {
    npm: "npm",
    PyPI: "PyPI",
    Go: "Go",
    Maven: "Maven",
    NuGet: "NuGet",
    "crates.io": "crates.io",
    Packagist: "Packagist",
    RubyGems: "RubyGems",
  };
  return mapping[ecosystem] || null;
}
