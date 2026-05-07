import * as semver from "semver";
import {
  EndOfLifeCycle,
  FreshnessEvaluation,
  FreshnessState,
  LtsStatus,
} from "./types";

const AMBER_DAYS_BEHIND = 30;
const RED_DAYS_BEHIND = 90;
const EOL_WARNING_MONTHS = 6;

export function evaluateWithEndOfLife(
  packageName: string,
  detectedVersion: string | null,
  cycle: EndOfLifeCycle | null,
  latestCycle: EndOfLifeCycle | null,
  existingFirstBehindAt: Date | null,
): FreshnessEvaluation {
  if (!detectedVersion || !cycle) {
    return unknownEvaluation(packageName, detectedVersion);
  }

  const latestVersion = latestCycle?.latest || cycle.latest;
  const versionsBehindMajor = computeMajorsBehind(
    detectedVersion,
    latestVersion,
  );
  const versionsBehindMinor = computeMinorsBehind(
    detectedVersion,
    latestVersion,
  );
  const eolDate = parseEolDate(cycle.eol);
  const ltsStatus = determineLtsStatus(cycle, eolDate);
  const state = computeEndOfLifeState(ltsStatus, eolDate);

  const firstBehindAt =
    versionsBehindMajor > 0 ? existingFirstBehindAt || new Date() : null;

  return {
    packageName,
    detectedVersion,
    latestVersion,
    versionsBehindMajor,
    versionsBehindMinor,
    ltsStatus,
    eolDate,
    state,
    firstBehindAt,
  };
}

export function evaluateWithRegistry(
  packageName: string,
  detectedVersion: string | null,
  latestVersion: string | null,
  existingFirstBehindAt: Date | null,
): FreshnessEvaluation {
  if (!detectedVersion || !latestVersion) {
    return unknownEvaluation(packageName, detectedVersion);
  }

  const versionsBehindMajor = computeMajorsBehind(
    detectedVersion,
    latestVersion,
  );
  const versionsBehindMinor = computeMinorsBehind(
    detectedVersion,
    latestVersion,
  );

  const firstBehindAt =
    versionsBehindMajor > 0 ? existingFirstBehindAt || new Date() : null;

  const daysBehind = firstBehindAt
    ? Math.floor((Date.now() - firstBehindAt.getTime()) / 86400000)
    : 0;

  const state = computeRegistryState(versionsBehindMajor, daysBehind);

  return {
    packageName,
    detectedVersion,
    latestVersion,
    versionsBehindMajor,
    versionsBehindMinor,
    ltsStatus: "unknown",
    eolDate: null,
    state,
    firstBehindAt,
  };
}

function computeEndOfLifeState(
  ltsStatus: LtsStatus,
  _eolDate: Date | null,
): FreshnessState {
  if (ltsStatus === "eol") return "red";
  if (ltsStatus === "lts_ending") return "amber";
  if (ltsStatus === "current" || ltsStatus === "lts") return "green";
  return "unknown";
}

function computeRegistryState(
  majorsBehind: number,
  daysBehind: number,
): FreshnessState {
  if (majorsBehind === 0) return "green";
  if (majorsBehind >= 3) return "red";
  if (majorsBehind >= 2 && daysBehind > RED_DAYS_BEHIND) return "red";
  if (majorsBehind >= 2) return "amber";
  if (majorsBehind === 1 && daysBehind > AMBER_DAYS_BEHIND) return "amber";
  return "green";
}

function determineLtsStatus(
  cycle: EndOfLifeCycle,
  eolDate: Date | null,
): LtsStatus {
  const now = new Date();

  if (eolDate && eolDate < now) return "eol";

  if (eolDate) {
    const warningDate = new Date(eolDate);
    warningDate.setMonth(warningDate.getMonth() - EOL_WARNING_MONTHS);
    if (now > warningDate) return "lts_ending";
  }

  if (
    cycle.lts === true ||
    (typeof cycle.lts === "string" && new Date(cycle.lts) <= now)
  ) {
    return "lts";
  }

  return "current";
}

function parseEolDate(eol: string | boolean): Date | null {
  if (typeof eol === "boolean") return null;
  const parsed = new Date(eol);
  return isNaN(parsed.getTime()) ? null : parsed;
}

export function computeMajorsBehind(detected: string, latest: string): number {
  const detectedMajor = parseMajor(detected);
  const latestMajor = parseMajor(latest);
  if (detectedMajor === null || latestMajor === null) return 0;
  return Math.max(0, latestMajor - detectedMajor);
}

export function computeMinorsBehind(detected: string, latest: string): number {
  const dCoerced = semver.coerce(detected);
  const lCoerced = semver.coerce(latest);
  if (!dCoerced || !lCoerced) return 0;
  if (dCoerced.major !== lCoerced.major) return 0;
  return Math.max(0, lCoerced.minor - dCoerced.minor);
}

function parseMajor(version: string): number | null {
  const coerced = semver.coerce(version);
  return coerced ? coerced.major : null;
}

function unknownEvaluation(
  packageName: string,
  detectedVersion: string | null,
): FreshnessEvaluation {
  return {
    packageName,
    detectedVersion,
    latestVersion: null,
    versionsBehindMajor: 0,
    versionsBehindMinor: 0,
    ltsStatus: "unknown",
    eolDate: null,
    state: "unknown",
    firstBehindAt: null,
  };
}
