export interface WatchlistPackage {
  name: string;
  ecosystem: string;
  endoflife_product: string | null;
  registry: "npmjs" | "maven" | null;
  match_component: string;
}

export interface Watchlist {
  packages: WatchlistPackage[];
}

export type LtsStatus = "current" | "lts" | "lts_ending" | "eol" | "unknown";
export type FreshnessState = "green" | "amber" | "red" | "unknown";

export interface EndOfLifeCycle {
  cycle: string;
  releaseDate: string;
  eol: string | boolean;
  lts: string | boolean;
  latest: string;
  latestReleaseDate: string;
}

export interface FreshnessEvaluation {
  packageName: string;
  detectedVersion: string | null;
  latestVersion: string | null;
  versionsBehindMajor: number;
  versionsBehindMinor: number;
  ltsStatus: LtsStatus;
  eolDate: Date | null;
  state: FreshnessState;
  firstBehindAt: Date | null;
}
