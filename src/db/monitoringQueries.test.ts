import { Pool } from "pg";
import {
  getSubmissionMetrics,
  getDrilldownData,
  type SubmissionMetricsBucket,
  type DrilldownWindow,
} from "./monitoringQueries";

function makeMockPool(responses: unknown[]): Pool {
  let callCount = 0;
  return {
    query: jest.fn().mockImplementation(() => {
      const rows = responses[callCount] ?? [];
      callCount++;
      return Promise.resolve({ rows });
    }),
  } as unknown as Pool;
}

describe("getSubmissionMetrics", () => {
  it("returns shaped buckets from query rows", async () => {
    const minute = new Date("2026-06-16T12:00:00Z");
    const rows = [
      {
        minute,
        total: "10",
        success: "8",
        failed: "2",
        pending: "0",
        error_rate_pct: "20.0",
      },
      {
        minute: new Date("2026-06-16T12:01:00Z"),
        total: "5",
        success: "5",
        failed: "0",
        pending: "0",
        error_rate_pct: "0.0",
      },
    ];
    const pool = makeMockPool([rows]);

    const result = await getSubmissionMetrics(pool, 24);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject<Partial<SubmissionMetricsBucket>>({
      minute,
      total: 10,
      success: 8,
      failed: 2,
      pending: 0,
      error_rate_pct: 20.0,
    });
    expect(result[1].error_rate_pct).toBe(0.0);
  });

  it("returns empty array when no rows", async () => {
    const pool = makeMockPool([[]]);
    const result = await getSubmissionMetrics(pool, 24);
    expect(result).toEqual([]);
  });

  it("returns null error_rate_pct for all-pending bucket", async () => {
    const rows = [
      {
        minute: new Date(),
        total: "3",
        success: "0",
        failed: "0",
        pending: "3",
        error_rate_pct: null,
      },
    ];
    const pool = makeMockPool([rows]);
    const result = await getSubmissionMetrics(pool, 24);
    expect(result[0].error_rate_pct).toBeNull();
  });

  it("passes windowHours as interval param to query", async () => {
    const pool = makeMockPool([[]]);
    await getSubmissionMetrics(pool, 12);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("$1"), [
      "12 hours",
    ]);
  });
});

describe("getDrilldownData", () => {
  it("returns populated DrilldownWindow from two queries", async () => {
    const minute = new Date("2026-06-16T12:00:00Z");
    const serviceRows = [
      { name: "repo-a", count: "15" },
      { name: "repo-b", count: "8" },
    ];
    const errorRows = [
      { error_type: "rate_limit", count: "10", pct: "66.7" },
      { error_type: "auth_error", count: "5", pct: "33.3" },
    ];
    const pendingRows = [{ pending_count: "2" }];
    const pool = makeMockPool([serviceRows, errorRows, pendingRows]);

    const result = await getDrilldownData(pool, minute);

    expect(result).toMatchObject<Partial<DrilldownWindow>>({
      minute,
      top_services: [
        { name: "repo-a", count: 15 },
        { name: "repo-b", count: 8 },
      ],
      error_breakdown: [
        { error_type: "rate_limit", count: 10, pct: 66.7 },
        { error_type: "auth_error", count: 5, pct: 33.3 },
      ],
      pending_count: 2,
    });
  });

  it("returns empty DrilldownWindow when no submissions", async () => {
    const minute = new Date("2026-06-16T12:00:00Z");
    const pool = makeMockPool([[], [], [{ pending_count: "0" }]]);

    const result = await getDrilldownData(pool, minute);

    expect(result).toMatchObject<DrilldownWindow>({
      minute,
      top_services: [],
      error_breakdown: [],
      pending_count: 0,
    });
  });

  it("passes minute as window boundary params", async () => {
    const minute = new Date("2026-06-16T12:00:00Z");
    const pool = makeMockPool([[], [], [{ pending_count: "0" }]]);

    await getDrilldownData(pool, minute);

    const firstCall = (pool.query as jest.Mock).mock.calls[0];
    expect(firstCall[1][0]).toEqual(minute);
  });
});
