CREATE TABLE osv_vulnerabilities (
  id              TEXT PRIMARY KEY,
  summary         TEXT,
  severity        TEXT CHECK (severity IN ('critical', 'high', 'medium', 'low', 'unknown')),
  cvss_score      NUMERIC(3,1),
  published       TIMESTAMPTZ NOT NULL,
  modified        TIMESTAMPTZ NOT NULL,
  withdrawn       TIMESTAMPTZ,
  raw_json        JSONB,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_osv_vulns_modified
  ON osv_vulnerabilities(modified DESC);

CREATE TABLE osv_affected_packages (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vuln_id               TEXT NOT NULL REFERENCES osv_vulnerabilities(id) ON DELETE CASCADE,
  ecosystem             TEXT NOT NULL,
  package_name          TEXT NOT NULL,
  introduced            TEXT,
  fixed                 TEXT,
  vulnerable_versions   TEXT[]
);

CREATE INDEX idx_osv_affected_ecosystem_name
  ON osv_affected_packages(ecosystem, package_name);

CREATE INDEX idx_osv_affected_vuln_id
  ON osv_affected_packages(vuln_id);

CREATE TABLE osv_sync_state (
  ecosystem       TEXT PRIMARY KEY,
  last_synced_at  TIMESTAMPTZ NOT NULL,
  vuln_count      INTEGER NOT NULL DEFAULT 0
);
