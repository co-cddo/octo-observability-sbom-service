import { Router } from "express";
import crypto from "crypto";
import { Pool } from "pg";
import PgBoss from "pg-boss";
import { S3Client, HeadBucketCommand } from "@aws-sdk/client-s3";
import { Config } from "../../config";
import { hashApiKey } from "../../ingest/apiKeyAuth";
import {
  getAllServices,
  getServiceById,
  createService,
  updateService,
  getKeysForService,
  insertApiKey,
  revokeApiKey,
  getRecentJobs,
  getJobCounts,
  getLatestSbomForService,
} from "../../db/queries";

export function adminRouter(pool: Pool, boss: PgBoss, config: Config): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.redirect("/admin/services");
  });

  // --- Services ---

  router.get("/services", async (_req, res) => {
    const services = await getAllServices(pool);
    res.render("admin/services.njk", {
      title: "Admin — Services",
      services,
      user: _req.session.user,
    });
  });

  router.get("/services/new", (req, res) => {
    res.render("admin/service-edit.njk", {
      title: "Admin — New Service",
      service: null,
      user: req.session.user,
    });
  });

  router.post("/services", async (req, res) => {
    const { name, organisation } = req.body;
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const id = await createService(pool, name, slug, organisation || "Unknown");
    res.redirect(`/admin/services/${id}/keys`);
  });

  router.get("/services/:id/edit", async (req, res) => {
    const service = await getServiceById(pool, req.params.id);
    if (!service) {
      res
        .status(404)
        .render("error.njk", {
          title: "Not found",
          message: "Service not found",
        });
      return;
    }
    res.render("admin/service-edit.njk", {
      title: `Admin — Edit ${service.name}`,
      service,
      user: req.session.user,
    });
  });

  router.post("/services/:id", async (req, res) => {
    const { name, organisation } = req.body;
    await updateService(pool, req.params.id, name, organisation);
    res.redirect("/admin/services");
  });

  router.post("/services/:id/delete", async (req, res) => {
    const id = req.params.id;
    await pool.query(
      "DELETE FROM sbom_vulnerability_indicators WHERE service_id = $1",
      [id],
    );
    await pool.query(
      "DELETE FROM sbom_release_cadence_indicators WHERE service_id = $1",
      [id],
    );
    await pool.query("DELETE FROM sbom_vulnerabilities WHERE service_id = $1", [
      id,
    ]);
    await pool.query("DELETE FROM sbom_records WHERE service_id = $1", [id]);
    await pool.query("DELETE FROM sbom_api_keys WHERE service_id = $1", [id]);
    await pool.query("DELETE FROM services WHERE id = $1", [id]);
    res.redirect("/admin/services");
  });

  // --- API Keys ---

  router.get("/services/:id/keys", async (req, res) => {
    const service = await getServiceById(pool, req.params.id);
    if (!service) {
      res
        .status(404)
        .render("error.njk", {
          title: "Not found",
          message: "Service not found",
        });
      return;
    }
    const keys = await getKeysForService(pool, req.params.id);
    res.render("admin/keys.njk", {
      title: `Admin — Keys for ${service.name}`,
      service,
      keys,
      user: req.session.user,
    });
  });

  router.post("/services/:id/keys", async (req, res) => {
    const service = await getServiceById(pool, req.params.id);
    if (!service) {
      res
        .status(404)
        .render("error.njk", {
          title: "Not found",
          message: "Service not found",
        });
      return;
    }

    const label = req.body.label || "default";
    const rawKey = `sbom_${crypto.randomBytes(32).toString("hex")}`;
    const keyHash = hashApiKey(rawKey);
    const keyPrefix = rawKey.substring(0, 8);
    const createdBy = req.session.user?.email || "unknown";

    await insertApiKey(
      pool,
      req.params.id,
      keyHash,
      keyPrefix,
      label,
      createdBy,
    );

    res.render("admin/key-created.njk", {
      title: "Admin — Key Created",
      service,
      rawKey,
      label,
      user: req.session.user,
    });
  });

  router.post("/services/:id/keys/:key_id/revoke", async (req, res) => {
    await revokeApiKey(pool, req.params.key_id);
    res.redirect(`/admin/services/${req.params.id}/keys`);
  });

  // --- Onboarding ---

  router.get("/services/:id/onboard", async (req, res) => {
    const service = await getServiceById(pool, req.params.id);
    if (!service) {
      res
        .status(404)
        .render("error.njk", {
          title: "Not found",
          message: "Service not found",
        });
      return;
    }
    const baseUrl = config.appUrl;
    res.render("admin/onboard.njk", {
      title: `Onboard — ${service.name}`,
      service,
      baseUrl,
      user: req.session.user,
    });
  });

  // --- Manual scan ---

  router.post("/services/:id/scan", async (req, res) => {
    const serviceId = req.params.id;
    const latestSbomId = await getLatestSbomForService(pool, serviceId);
    if (!latestSbomId) {
      res.redirect(`/admin/services/${serviceId}/keys`);
      return;
    }
    await boss.send("scan-vulnerabilities", {
      recordId: latestSbomId,
      serviceId,
    });
    res.redirect(`/services/${serviceId}`);
  });

  // --- Sync ---

  router.post("/sync", async (_req, res) => {
    await boss.send("osv-sync", {});
    res.redirect("/admin/jobs");
  });

  router.post("/freshness-sync", async (_req, res) => {
    await boss.send("freshness-sync", {});
    res.redirect("/admin/jobs");
  });

  // --- Jobs ---

  router.get("/jobs", async (req, res) => {
    const jobs = await getRecentJobs(pool, 50);
    const counts = await getJobCounts(pool);
    res.render("admin/jobs.njk", {
      title: "Admin — Jobs",
      jobs,
      counts,
      user: req.session.user,
    });
  });

  // --- Health ---

  router.get("/health", async (req, res) => {
    const checks: { name: string; status: "ok" | "error"; detail?: string }[] =
      [];

    try {
      await pool.query("SELECT 1");
      checks.push({ name: "Database", status: "ok" });
    } catch (e) {
      checks.push({ name: "Database", status: "error", detail: String(e) });
    }

    try {
      const s3 = new S3Client({
        region: config.s3Region,
        ...(config.s3Endpoint
          ? {
              endpoint: config.s3Endpoint,
              forcePathStyle: true,
              credentials: { accessKeyId: "test", secretAccessKey: "test" },
            }
          : {}),
      });
      await s3.send(new HeadBucketCommand({ Bucket: config.s3BucketName }));
      checks.push({ name: "S3 Bucket", status: "ok" });
    } catch (e) {
      checks.push({ name: "S3 Bucket", status: "error", detail: String(e) });
    }

    try {
      const counts = await getJobCounts(pool);
      checks.push({
        name: "Job Queue",
        status: "ok",
        detail: `${counts.created} pending, ${counts.active} active, ${counts.failed} failed`,
      });
    } catch (e) {
      checks.push({ name: "Job Queue", status: "error", detail: String(e) });
    }

    try {
      const resp = await fetch(
        `${config.osvApiUrl}/v1/vulns/GHSA-0000-0000-0000`,
      );
      checks.push({
        name: "OSV.dev API",
        status: resp.status === 404 || resp.ok ? "ok" : "error",
        detail: `HTTP ${resp.status}`,
      });
    } catch (e) {
      checks.push({ name: "OSV.dev API", status: "error", detail: String(e) });
    }

    const syncState = await pool.query(
      "SELECT ecosystem, last_synced_at, vuln_count FROM osv_sync_state ORDER BY ecosystem",
    );

    const allOk = checks.every((c) => c.status === "ok");
    res.render("admin/health.njk", {
      title: "Admin — Health",
      checks,
      allOk,
      syncState: syncState.rows,
      user: req.session.user,
    });
  });

  return router;
}
