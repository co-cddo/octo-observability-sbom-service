import { readFileSync } from "fs";
import { join } from "path";
import { parse } from "yaml";
import { Watchlist, WatchlistPackage } from "./types";

export function loadWatchlist(): WatchlistPackage[] {
  const filePath = join(__dirname, "watchlist.yaml");
  const content = readFileSync(filePath, "utf-8");
  const parsed = parse(content) as Watchlist;
  return parsed.packages;
}
