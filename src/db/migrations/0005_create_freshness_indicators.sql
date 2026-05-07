CREATE TABLE sbom_freshness_indicators (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id            UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  package_name          TEXT NOT NULL,
  detected_version      TEXT,
  latest_version        TEXT,
  versions_behind_major INT DEFAULT 0,
  versions_behind_minor INT DEFAULT 0,
  lts_status            TEXT CHECK (lts_status IN ('current', 'lts', 'lts_ending', 'eol', 'unknown')),
  eol_date              DATE,
  state                 TEXT CHECK (state IN ('green', 'amber', 'red', 'unknown')) DEFAULT 'unknown',
  first_behind_at       TIMESTAMPTZ,
  evaluated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (service_id, package_name)
);

CREATE INDEX idx_freshness_service_id
  ON sbom_freshness_indicators(service_id);

CREATE INDEX idx_freshness_state
  ON sbom_freshness_indicators(state);
