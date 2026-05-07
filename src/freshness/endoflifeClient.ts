import { EndOfLifeCycle } from "./types";

const BASE_URL = "https://endoflife.date/api";

export async function fetchEndOfLifeCycles(
  product: string,
): Promise<EndOfLifeCycle[]> {
  const url = `${BASE_URL}/${product}.json`;
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    console.warn(
      `[freshness] endoflife.date returned ${response.status} for ${product}`,
    );
    return [];
  }

  const data = (await response.json()) as EndOfLifeCycle[];
  return data;
}

export function findCycleForVersion(
  cycles: EndOfLifeCycle[],
  detectedVersion: string,
): EndOfLifeCycle | null {
  const majorMinor = extractMajorMinor(detectedVersion);
  if (!majorMinor) return null;

  for (const cycle of cycles) {
    if (
      cycle.cycle === majorMinor ||
      cycle.cycle === majorMinor.split(".")[0]
    ) {
      return cycle;
    }
  }

  const major = majorMinor.split(".")[0];
  for (const cycle of cycles) {
    if (cycle.cycle === major) {
      return cycle;
    }
  }

  return null;
}

function extractMajorMinor(version: string): string | null {
  const match = version.match(/^v?(\d+(?:\.\d+)?)/);
  return match ? match[1] : null;
}
