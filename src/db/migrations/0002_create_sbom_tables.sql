CREATE TABLE sbom_api_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id    UUID NOT NULL REFERENCES services(id),
  key_hash      TEXT NOT NULL,
  key_prefix    TEXT NOT NULL,
  label         TEXT NOT NULL,
  created_by    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at    TIMESTAMPTZ,
  last_used_at  TIMESTAMPTZ
);

CREATE INDEX idx_sbom_api_keys_service
  ON sbom_api_keys(service_id) WHERE revoked_at IS NULL;

CREATE INDEX idx_sbom_api_keys_prefix
  ON sbom_api_keys(key_prefix);

CREATE TABLE sbom_records (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id            UUID NOT NULL REFERENCES services(id),
  s3_key                TEXT NOT NULL UNIQUE,
  format                TEXT NOT NULL CHECK (format IN ('cyclonedx', 'spdx')),
  format_version        TEXT,
  component_count       INTEGER NOT NULL DEFAULT 0,
  received_at           TIMESTAMPTZ NOT NULL,
  submitted_by          TEXT NOT NULL,
  normalisation_status  TEXT NOT NULL CHECK (normalisation_status IN ('pending', 'complete', 'failed')),
  error_message         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sbom_records_service_received
  ON sbom_records(service_id, received_at DESC);

CREATE TABLE sbom_components (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sbom_record_id  UUID NOT NULL REFERENCES sbom_records(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  version         TEXT NOT NULL,
  ecosystem       TEXT NOT NULL,
  purl            TEXT,
  license         TEXT
);

CREATE INDEX idx_sbom_components_sbom
  ON sbom_components(sbom_record_id);

CREATE INDEX idx_sbom_components_ecosystem_name
  ON sbom_components(ecosystem, name, version);
