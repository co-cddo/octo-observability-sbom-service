declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      apiKeyLabel?: string;
    }
  }
}

export interface NormalisedComponent {
  name: string;
  version: string;
  ecosystem: string;
  purl: string | null;
  license: string | null;
}

export interface OsvVulnerability {
  id: string;
  severity: "critical" | "high" | "medium" | "low" | "unknown";
  cvssScore: number | null;
  affectedPackage: string;
  affectedVersion: string;
  fixedVersion: string | null;
  ecosystem: string;
}

export type SbomFormat = "cyclonedx" | "spdx";
