export interface NpmVersionInfo {
  latest: string;
  allMajors: number[];
}

export async function fetchNpmLatest(
  packageName: string,
): Promise<NpmVersionInfo | null> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    console.warn(
      `[freshness] npm registry returned ${response.status} for ${packageName}`,
    );
    return null;
  }

  const data = (await response.json()) as {
    "dist-tags": { latest: string };
    versions: Record<string, unknown>;
  };
  const latest = data["dist-tags"]?.latest;
  if (!latest) return null;

  const allMajors = [
    ...new Set(
      Object.keys(data.versions)
        .map((v) => {
          const match = v.match(/^(\d+)\./);
          return match ? parseInt(match[1], 10) : null;
        })
        .filter((m): m is number => m !== null),
    ),
  ].sort((a, b) => b - a);

  return { latest, allMajors };
}
