export interface MavenVersionInfo {
  latest: string;
  allMajors: number[];
}

export async function fetchMavenLatest(
  groupArtifact: string,
): Promise<MavenVersionInfo | null> {
  const [groupId, artifactId] = groupArtifact.split(":");
  if (!groupId || !artifactId) return null;

  const url = `https://search.maven.org/solrsearch/select?q=g:${encodeURIComponent(groupId)}+AND+a:${encodeURIComponent(artifactId)}&rows=100&core=gav&wt=json`;
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    console.warn(
      `[freshness] Maven Central returned ${response.status} for ${groupArtifact}`,
    );
    return null;
  }

  const data = (await response.json()) as {
    response: { docs: { v: string }[] };
  };
  const docs = data.response?.docs || [];
  if (docs.length === 0) return null;

  const versions = docs.map((d) => d.v);
  const latest = versions[0];

  const allMajors = [
    ...new Set(
      versions
        .map((v) => {
          const match = v.match(/^(\d+)\./);
          return match ? parseInt(match[1], 10) : null;
        })
        .filter((m): m is number => m !== null),
    ),
  ].sort((a, b) => b - a);

  return { latest, allMajors };
}
