import { createWriteStream } from "fs";
import { mkdir } from "fs/promises";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import path from "path";
import os from "os";

const GCS_BASE = "https://osv-vulnerabilities.storage.googleapis.com";

export const SUPPORTED_ECOSYSTEMS = [
  "npm",
  "PyPI",
  "Go",
  "Maven",
  "NuGet",
  "crates.io",
  "Packagist",
];

export async function downloadEcosystemZip(ecosystem: string): Promise<string> {
  const url = `${GCS_BASE}/${ecosystem}/all.zip`;
  const dir = path.join(os.tmpdir(), "osv-sync", ecosystem);
  await mkdir(dir, { recursive: true });
  const zipPath = path.join(dir, "all.zip");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }

  const writeStream = createWriteStream(zipPath);
  await pipeline(Readable.fromWeb(response.body as never), writeStream);

  return zipPath;
}

export async function fetchVulnJson(
  ecosystem: string,
  vulnId: string,
): Promise<unknown> {
  const url = `${GCS_BASE}/${ecosystem}/${vulnId}.json`;
  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.json();
}

export interface ModifiedEntry {
  modified: string;
  ecosystem: string;
  id: string;
}

export async function fetchModifiedIds(
  ecosystem: string,
  since: Date,
): Promise<ModifiedEntry[]> {
  const url = `${GCS_BASE}/${ecosystem}/modified_id.csv`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  const text = await response.text();
  const entries: ModifiedEntry[] = [];

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const [modified, filePath] = line.split(",");
    if (!modified || !filePath) continue;

    const modDate = new Date(modified);
    if (modDate <= since) continue;

    const id = filePath.replace(`${ecosystem}/`, "").replace(".json", "");
    entries.push({ modified, ecosystem, id });
  }

  return entries;
}
