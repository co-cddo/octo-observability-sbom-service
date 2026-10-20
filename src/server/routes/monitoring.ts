import { Router } from "express";
import { Pool } from "pg";
import {
  getSubmissionMetrics,
  getDrilldownData,
} from "../../db/monitoringQueries";

export function monitoringRouter(pool: Pool): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    try {
      const metrics = await getSubmissionMetrics(pool, 24);
      res.render("monitoring.njk", {
        title: "Submission Monitoring",
        metrics: JSON.stringify(metrics),
      });
    } catch {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/api/metrics", async (_req, res) => {
    try {
      const metrics = await getSubmissionMetrics(pool, 24);
      res.json(metrics);
    } catch {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/api/drilldown", async (req, res) => {
    const { minute } = req.query;
    if (!minute || typeof minute !== "string") {
      res
        .status(400)
        .json({ error: "minute query param required (ISO string)" });
      return;
    }
    const minuteDate = new Date(minute);
    if (isNaN(minuteDate.getTime())) {
      res
        .status(400)
        .json({ error: "minute query param must be a valid ISO date string" });
      return;
    }
    try {
      const data = await getDrilldownData(pool, minuteDate);
      res.json(data);
    } catch {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
