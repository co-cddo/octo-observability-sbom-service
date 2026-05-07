import { NormalisedComponent } from "../types";

interface SpdxPackage {
  name?: string;
  versionInfo?: string;
  downloadLocation?: string;
  licenseConcluded?: string;
  licenseDeclared?: string;
  externalRefs?: {
    referenceCategory?: string;
    referenceType?: string;
    referenceLocator?: string;
  }[];
}

interface SpdxSbom {
  packages?: SpdxPackage[];
}

export function parseSpdx(payload: unknown): NormalisedComponent[] {
  const sbom = payload as SpdxSbom;
  const packages = sbom.packages || [];

  return packages
    .filter((p) => p.name && p.versionInfo && p.name !== "SPDXRef-DOCUMENT")
    .map((p) => {
      const purl = extractPurl(p.externalRefs);
      return {
        name: p.name!,
        version: p.versionInfo!,
        ecosystem: extractEcosystemFromPurl(purl) || "unknown",
        purl,
        license: normaliseLicense(p.licenseConcluded || p.licenseDeclared),
      };
    });
}

function extractPurl(refs: SpdxPackage["externalRefs"]): string | null {
  if (!refs) return null;
  const purlRef = refs.find(
    (r) =>
      r.referenceType === "purl" || r.referenceCategory === "PACKAGE-MANAGER",
  );
  return purlRef?.referenceLocator || null;
}

function extractEcosystemFromPurl(purl: string | null): string | null {
  if (!purl) return null;
  const match = purl.match(/^pkg:([^/]+)\//);
  if (!match) return null;
  const mapping: Record<string, string> = {
    npm: "npm",
    pypi: "PyPI",
    golang: "Go",
    maven: "Maven",
    gem: "RubyGems",
    nuget: "NuGet",
    cargo: "crates.io",
    composer: "Packagist",
  };
  return mapping[match[1]] || match[1];
}

function normaliseLicense(license: string | undefined | null): string | null {
  if (!license || license === "NOASSERTION" || license === "NONE") return null;
  return license;
}
