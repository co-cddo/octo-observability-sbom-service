import { Pool } from "pg";
import PgBoss from "pg-boss";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { Config } from "../config";
import { parseCycloneDx } from "./cyclonedxParser";
import { parseSpdx } from "./spdxParser";
import {
  insertComponents,
  updateSbomRecordStatus,
  getServiceById,
} from "../db/queries";
import { NormalisedComponent, SbomFormat } from "../types";

interface NormaliseJobData {
  recordId: string;
  serviceId: string;
  s3Key: string;
  format: SbomFormat;
}

export function registerNormaliseHandler(
  boss: PgBoss,
  pool: Pool,
  config: Config,
): void {
  boss.work<NormaliseJobData>(
    "normalise-sbom",
    { batchSize: 1 },
    async (jobs) => {
      if (jobs.length !== 1)
        throw new Error(`Expected 1 job, got ${jobs.length}`);
      const job = jobs[0];
      const { recordId, serviceId, s3Key, format } = job.data;
      const payload = await fetchFromS3(config, s3Key);
      const parsed = JSON.parse(payload);

      let components: NormalisedComponent[];
      if (format === "cyclonedx") {
        components = parseCycloneDx(parsed);
      } else {
        components = parseSpdx(parsed);
      }

      await insertComponents(pool, recordId, components);
      await updateSbomRecordStatus(
        pool,
        recordId,
        "complete",
        components.length,
      );

      await boss.send("scan-vulnerabilities", { recordId, serviceId });
      await boss.send("update-cadence", { serviceId });

      console.log(
        `Normalised SBOM ${recordId}: ${components.length} components`,
      );
      const service = await getServiceById(pool, serviceId);
      return `${service?.name || serviceId} - ${format} - ${components.length} components`;
    },
  );
}

async function fetchFromS3(config: Config, key: string): Promise<string> {
  const client = new S3Client({
    region: config.s3Region,
    ...(config.s3Endpoint
      ? {
          endpoint: config.s3Endpoint,
          forcePathStyle: true,
          credentials: { accessKeyId: "test", secretAccessKey: "test" },
        }
      : {}),
  });

  const response = await client.send(
    new GetObjectCommand({ Bucket: config.s3BucketName, Key: key }),
  );

  return await response.Body!.transformToString("utf-8");
}
