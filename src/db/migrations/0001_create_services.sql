CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS services (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  slug             TEXT NOT NULL UNIQUE,
  organisation     TEXT NOT NULL,
  live_service_url TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
