import { NormalisedComponent } from "../types";

interface CycloneDxComponent {
  type?: string;
  name?: string;
  version?: string;
  purl?: string;
  licenses?: { license?: { id?: string; name?: string } }[];
}

interface CycloneDxSbom {
  components?: CycloneDxComponent[];
}

export function parseCycloneDx(payload: unknown): NormalisedComponent[] {
  const sbom = payload as CycloneDxSbom;
  const components = sbom.components || [];

  return components
    .filter((c) => c.name && c.version)
    .map((c) => ({
      name: c.name!,
      version: c.version!,
      ecosystem: extractEcosystem(c.purl) || c.type || "unknown",
      purl: c.purl || null,
      license: extractLicense(c.licenses),
    }));
}

function extractEcosystem(purl: string | undefined): string | null {
  if (!purl) return null;
  const match = purl.match(/^pkg:([^/]+)\//);
  return match ? mapPurlType(match[1]) : null;
}

function mapPurlType(purlType: string): string {
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
  return mapping[purlType] || purlType;
}

function extractLicense(
  licenses: { license?: { id?: string; name?: string } }[] | undefined,
): string | null {
  if (!licenses || licenses.length === 0) return null;
  const first = licenses[0]?.license;
  return first?.id || first?.name || null;
}
