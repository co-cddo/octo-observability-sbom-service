import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { Config } from "../config";

let client: S3Client | null = null;

function getClient(config: Config): S3Client {
  if (!client) {
    client = new S3Client({
      region: config.s3Region,
      ...(config.s3Endpoint
        ? {
            endpoint: config.s3Endpoint,
            forcePathStyle: true,
            credentials: { accessKeyId: "test", secretAccessKey: "test" },
          }
        : {}),
    });
  }
  return client;
}

export async function writeToS3(
  config: Config,
  key: string,
  body: string,
): Promise<void> {
  const s3 = getClient(config);
  await s3.send(
    new PutObjectCommand({
      Bucket: config.s3BucketName,
      Key: key,
      Body: body,
      ContentType: "application/json",
    }),
  );
}

export function buildS3Key(serviceId: string, format: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `sboms/${serviceId}/${timestamp}-${format}.json`;
}
