import { Router } from "express";
import { Pool } from "pg";
import { getDashboardData } from "../../db/queries";

const VALID_SORT_COLUMNS = [
  "service",
  "organisation",
  "critical",
  "high",
  "cadence",
  "freshness",
] as const;

type SortColumn = (typeof VALID_SORT_COLUMNS)[number];
type SortDirection = "asc" | "desc";

function parseSortParams(query: Record<string, unknown>): {
  sort: SortColumn;
  dir: SortDirection;
} {
  const sort = VALID_SORT_COLUMNS.includes(query.sort as SortColumn)
    ? (query.sort as SortColumn)
    : "organisation";
  const dir = query.dir === "desc" ? "desc" : "asc";
  return { sort, dir };
}

function sortServices(
  services: Record<string, unknown>[],
  sort: SortColumn,
  dir: SortDirection,
): void {
  const multiplier = dir === "asc" ? 1 : -1;

  const keyMap: Record<SortColumn, string> = {
    service: "name",
    organisation: "organisation",
    critical: "critical_cve_count",
    high: "high_cve_count",
    cadence: "cadence_state",
    freshness: "freshness_state",
  };

  const key = keyMap[sort];

  services.sort((a, b) => {
    const aVal = a[key];
    const bVal = b[key];
    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;
    if (typeof aVal === "number" && typeof bVal === "number")
      return (aVal - bVal) * multiplier;
    return String(aVal).localeCompare(String(bVal)) * multiplier;
  });
}

export function dashboardRouter(pool: Pool): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    const data = await getDashboardData(pool);
    const { sort, dir } = parseSortParams(req.query as Record<string, unknown>);
    sortServices(data.services, sort, dir);
    res.render("dashboard.njk", {
      title: "SBOM Dashboard",
      user: req.session.user,
      services: data.services,
      sort,
      dir,
    });
  });

  return router;
}
