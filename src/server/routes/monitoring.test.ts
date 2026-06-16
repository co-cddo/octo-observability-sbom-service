import express from "express";
import request from "supertest";
import nunjucks from "nunjucks";
import path from "path";
import { monitoringRouter } from "./monitoring";
import * as monitoringQueries from "../../db/monitoringQueries";
import type {
  SubmissionMetricsBucket,
  DrilldownWindow,
} from "../../db/monitoringQueries";
import { Pool } from "pg";

jest.mock("../../db/monitoringQueries");

const mockGetSubmissionMetrics =
  monitoringQueries.getSubmissionMetrics as jest.MockedFunction<
    typeof monitoringQueries.getSubmissionMetrics
  >;
const mockGetDrilldownData =
  monitoringQueries.getDrilldownData as jest.MockedFunction<
    typeof monitoringQueries.getDrilldownData
  >;

const fakeBuckets: SubmissionMetricsBucket[] = [
  {
    minute: new Date("2026-06-16T12:00:00Z"),
    total: 10,
    success: 8,
    failed: 2,
    pending: 0,
    error_rate_pct: 20.0,
  },
];

const fakeDrilldown: DrilldownWindow = {
  minute: new Date("2026-06-16T12:00:00Z"),
  top_services: [{ name: "repo-a", count: 10 }],
  error_breakdown: [{ error_type: "rate_limit", count: 2, pct: 100.0 }],
  pending_count: 0,
};

function buildApp(): express.Application {
  const app = express();

  app.use((_req, res, next) => {
    res.locals.cspNonce = "test-nonce";
    next();
  });

  const viewsDir = path.join(__dirname, "../views");
  const govukDir = path.join(
    __dirname,
    "../../../node_modules/govuk-frontend/dist",
  );
  const env = nunjucks.configure([viewsDir, govukDir], {
    autoescape: true,
    express: app,
  });
  env.addGlobal("user", { name: "Test User" });
  env.addGlobal("cspNonce", "test-nonce");

  const mockPool = {} as Pool;
  app.use("/", monitoringRouter(mockPool));
  return app;
}

describe("GET /", () => {
  it("returns 200 and renders monitoring page", async () => {
    mockGetSubmissionMetrics.mockResolvedValueOnce(fakeBuckets);

    const res = await request(buildApp()).get("/");

    expect(res.status).toBe(200);
    expect(res.text).toContain("Submission Monitoring");
  });

  it("returns 500 when query throws", async () => {
    mockGetSubmissionMetrics.mockRejectedValueOnce(new Error("DB error"));

    const res = await request(buildApp()).get("/");

    expect(res.status).toBe(500);
  });
});

describe("GET /api/metrics", () => {
  it("returns 200 with JSON array of buckets", async () => {
    mockGetSubmissionMetrics.mockResolvedValueOnce(fakeBuckets);

    const res = await request(buildApp()).get("/api/metrics");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].total).toBe(10);
  });

  it("returns 500 when query throws", async () => {
    mockGetSubmissionMetrics.mockRejectedValueOnce(new Error("DB error"));

    const res = await request(buildApp()).get("/api/metrics");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error" });
  });
});

describe("GET /api/drilldown", () => {
  it("returns 200 with DrilldownWindow when minute param valid", async () => {
    mockGetDrilldownData.mockResolvedValueOnce(fakeDrilldown);

    const res = await request(buildApp()).get(
      "/api/drilldown?minute=2026-06-16T12:00:00.000Z",
    );

    expect(res.status).toBe(200);
    expect(res.body.top_services).toHaveLength(1);
    expect(res.body.top_services[0].name).toBe("repo-a");
  });

  it("returns 400 when minute param missing", async () => {
    const res = await request(buildApp()).get("/api/drilldown");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/minute/i);
  });

  it("returns 400 when minute param is not a valid date", async () => {
    const res = await request(buildApp()).get(
      "/api/drilldown?minute=not-a-date",
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/minute/i);
  });

  it("returns 500 when query throws", async () => {
    mockGetDrilldownData.mockRejectedValueOnce(new Error("DB error"));

    const res = await request(buildApp()).get(
      "/api/drilldown?minute=2026-06-16T12:00:00.000Z",
    );

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error" });
  });
});
