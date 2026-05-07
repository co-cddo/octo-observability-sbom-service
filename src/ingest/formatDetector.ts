import { SbomFormat } from "../types";

interface CycloneDxPayload {
  bomFormat?: string;
  specVersion?: string;
}

interface SpdxPayload {
  spdxVersion?: string;
  SPDXID?: string;
}

export function detectFormat(
  contentType: string | undefined,
  body: Record<string, unknown>,
): { format: SbomFormat; version: string | null } {
  if (contentType?.includes("application/spdx+json")) {
    const spdx = body as unknown as SpdxPayload;
    return { format: "spdx", version: spdx.spdxVersion || null };
  }

  const cdx = body as unknown as CycloneDxPayload;
  if (cdx.bomFormat === "CycloneDX") {
    return { format: "cyclonedx", version: cdx.specVersion || null };
  }

  const spdx = body as unknown as SpdxPayload;
  if (spdx.spdxVersion && spdx.SPDXID) {
    return { format: "spdx", version: spdx.spdxVersion || null };
  }

  throw new FormatDetectionError(
    "Unrecognised SBOM format. Expected CycloneDX or SPDX JSON.",
  );
}

export class FormatDetectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormatDetectionError";
  }
}
