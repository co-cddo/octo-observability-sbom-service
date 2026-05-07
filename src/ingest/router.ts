import { Router, Request, Response } from "express";
import { Pool } from "pg";
import PgBoss from "pg-boss";
import { Config } from "../config";
import { createApiKeyAuthMiddleware } from "./apiKeyAuth";
import { detectFormat, FormatDetectionError } from "./formatDetector";
import { writeToS3, buildS3Key } from "./s3Client";
import { insertSbomRecord, serviceExists } from "../db/queries";

export function createIngestRouter(
  pool: Pool,
  boss: PgBoss,
  config: Config,
): Router {
  const router = Router();
  const apiKeyAuth = createApiKeyAuthMiddleware(pool);

  router.post(
    "/services/:service_id",
    apiKeyAuth,
    async (
      req: Request<{ service_id: string }>,
      res: Response,
    ): Promise<void> => {
      const { service_id } = req.params;

      const exists = await serviceExists(pool, service_id);
      if (!exists) {
        res.status(404).json({ error: "Service not found" });
        return;
      }

      let format: string;
      let formatVersion: string | null;
      try {
        const contentType = req.headers["content-type"] as string | undefined;
        const detected = detectFormat(contentType, req.body);
        format = detected.format;
        formatVersion = detected.version;
      } catch (err) {
        if (err instanceof FormatDetectionError) {
          res.status(422).json({ error: err.message });
          return;
        }
        throw err;
      }

      const s3Key = buildS3Key(service_id, format);
      const rawPayload = JSON.stringify(req.body);

      await writeToS3(config, s3Key, rawPayload);

      const receivedAt = new Date();
      const recordId = await insertSbomRecord(pool, {
        serviceId: service_id,
        s3Key,
        format,
        formatVersion,
        receivedAt,
        submittedBy: req.apiKeyLabel || "unknown",
      });

      const jobId = await boss.send("normalise-sbom", {
        recordId,
        serviceId: service_id,
        s3Key,
        format,
      });
      console.log(`Enqueued normalise-sbom job: ${jobId}`);

      res.status(202).json({
        status: "accepted",
        record_id: recordId,
        s3_key: s3Key,
        received_at: receivedAt.toISOString(),
      });
    },
  );

  return router;
}
