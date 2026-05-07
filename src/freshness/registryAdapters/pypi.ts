export interface PypiVersionInfo {
  latest: string;
  allMajors: number[];
}

export async function fetchPypiLatest(
  packageName: string,
): Promise<PypiVersionInfo | null> {
  const url = `https://pypi.org/pypi/${encodeURIComponent(packageName)}/json`;
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    console.warn(
      `[freshness] PyPI returned ${response.status} for ${packageName}`,
    );
    return null;
  }

  const data = (await response.json()) as {
    info: { version: string };
    releases: Record<string, unknown>;
  };
  const latest = data.info?.version;
  if (!latest) return null;

  const allMajors = [
    ...new Set(
      Object.keys(data.releases)
        .map((v) => {
          const match = v.match(/^(\d+)\./);
          return match ? parseInt(match[1], 10) : null;
        })
        .filter((m): m is number => m !== null),
    ),
  ].sort((a, b) => b - a);

  return { latest, allMajors };
}
