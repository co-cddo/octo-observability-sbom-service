import dotenv from "dotenv";

dotenv.config();

export interface Config {
  port: number;
  nodeEnv: string;
  appUrl: string;
  databaseUrl: string;
  s3BucketName: string;
  s3Region: string;
  s3Endpoint: string | undefined;
  osvApiUrl: string;
  maxPayloadBytes: number;
  oidcIssuerUrl: string;
  oidcClientId: string;
  oidcClientSecret: string;
  oidcRedirectUri: string;
  sessionSecret: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function buildDatabaseUrl(): string {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  const host = requireEnv("DATABASE_HOST");
  const port = process.env.DATABASE_PORT || "5432";
  const user = requireEnv("DATABASE_USER");
  const password = requireEnv("DATABASE_PASSWORD");
  const name = requireEnv("DATABASE_NAME");
  const base = `postgres://${user}:${password}@${host}:${port}/${name}`;
  if (process.env.NODE_ENV === "production") {
    return `${base}?ssl=true&sslmode=no-verify`;
  }
  return base;
}

export function loadConfig(): Config {
  const nodeEnv = process.env.NODE_ENV || "development";

  const sessionSecret = requireEnv("SESSION_SECRET");
  if (nodeEnv === "production" && sessionSecret.length < 32) {
    throw new Error(
      "SESSION_SECRET must be at least 32 characters in production",
    );
  }

  const port = parseInt(process.env.PORT || "3000", 10);

  return {
    port,
    nodeEnv,
    appUrl: process.env.APP_URL || `http://localhost:${port}`,
    databaseUrl: buildDatabaseUrl(),
    s3BucketName: requireEnv("S3_BUCKET_NAME"),
    s3Region: process.env.S3_REGION || "eu-west-2",
    s3Endpoint: process.env.S3_ENDPOINT,
    osvApiUrl: process.env.OSV_API_URL || "https://api.osv.dev",
    maxPayloadBytes: parseInt(process.env.MAX_PAYLOAD_BYTES || "10485760", 10),
    oidcIssuerUrl: requireEnv("OIDC_ISSUER_URL"),
    oidcClientId: requireEnv("OIDC_CLIENT_ID"),
    oidcClientSecret: requireEnv("OIDC_CLIENT_SECRET"),
    oidcRedirectUri: requireEnv("OIDC_REDIRECT_URI"),
    sessionSecret,
  };
}
