import { Router } from "express";
import { Pool } from "pg";
import { getServiceDetail, getFreshnessForService } from "../../db/queries";

export function servicesRouter(pool: Pool): Router {
  const router = Router();

  router.get("/:service_id", async (req, res) => {
    const { service_id } = req.params;
    const [data, freshness] = await Promise.all([
      getServiceDetail(pool, service_id),
      getFreshnessForService(pool, service_id),
    ]);

    const service = await pool.query(
      "SELECT id, name, organisation FROM services WHERE id = $1",
      [service_id],
    );
    if (service.rowCount === 0) {
      res
        .status(404)
        .render("error.njk", {
          title: "Not found",
          message: "Service not found",
        });
      return;
    }

    res.render("service-detail.njk", {
      title: service.rows[0].name,
      user: req.session.user,
      service: service.rows[0],
      vulnerabilities: data.vulnerabilities,
      timeToPatch: data.timeToPatch,
      recentSboms: data.recentSboms,
      freshness,
    });
  });

  return router;
}
