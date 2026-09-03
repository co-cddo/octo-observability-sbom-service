import { Pool } from "pg";

export type SubmissionMetricsBucket = {
  minute: Date;
  total: number;
  success: number;
  failed: number;
  pending: number;
  error_rate_pct: number | null;
};

export type ServiceCount = {
  name: string;
  count: number;
};

export type ErrorBreakdown = {
  error_type: string;
  count: number;
  pct: number;
};

export type DrilldownWindow = {
  minute: Date;
  top_services: ServiceCount[];
  error_breakdown: ErrorBreakdown[];
  pending_count: number;
};

export async function getSubmissionMetrics(
  pool: Pool,
  windowHours: number,
): Promise<SubmissionMetricsBucket[]> {
  const result = await pool.query(
    `SELECT
       DATE_TRUNC('minute', received_at) AS minute,
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE normalisation_status = 'complete') AS success,
       COUNT(*) FILTER (WHERE normalisation_status = 'failed') AS failed,
       COUNT(*) FILTER (WHERE normalisation_status = 'pending') AS pending,
       ROUND(
         COUNT(*) FILTER (WHERE normalisation_status = 'failed')::numeric /
         NULLIF(
           COUNT(*) FILTER (WHERE normalisation_status IN ('complete', 'failed')),
           0
         ) * 100,
         1
       ) AS error_rate_pct
     FROM sbom_records
     WHERE received_at >= NOW() - $1::interval
     GROUP BY 1
     ORDER BY 1`,
    [`${windowHours} hours`],
  );

  return result.rows.map((row) => ({
    minute: row.minute,
    total: Number(row.total),
    success: Number(row.success),
    failed: Number(row.failed),
    pending: Number(row.pending),
    error_rate_pct:
      row.error_rate_pct !== null ? Number(row.error_rate_pct) : null,
  }));
}

export async function getDrilldownData(
  pool: Pool,
  minute: Date,
): Promise<DrilldownWindow> {
  const servicesResult = await pool.query(
    `SELECT s.name, COUNT(*) AS count
     FROM sbom_records sr
     JOIN services s ON s.id = sr.service_id
     WHERE sr.received_at >= $1
       AND sr.received_at < $1 + INTERVAL '1 minute'
     GROUP BY s.id, s.name
     ORDER BY count DESC
     LIMIT 5`,
    [minute],
  );

  const errorResult = await pool.query(
    `SELECT
       CASE
         WHEN error_message ILIKE '%rate limit%' THEN 'rate_limit'
         WHEN error_message ILIKE '%validation%' THEN 'validation_error'
         WHEN error_message ILIKE '%auth%' THEN 'auth_error'
         WHEN error_message ILIKE '%timeout%' THEN 'timeout'
         ELSE 'unknown'
       END AS error_type,
       COUNT(*) AS count,
       ROUND(COUNT(*)::numeric / NULLIF(SUM(COUNT(*)) OVER (), 0) * 100, 1) AS pct
     FROM sbom_records
     WHERE received_at >= $1
       AND received_at < $1 + INTERVAL '1 minute'
       AND normalisation_status = 'failed'
     GROUP BY 1
     ORDER BY count DESC`,
    [minute],
  );

  const pendingResult = await pool.query(
    `SELECT COUNT(*) AS pending_count
     FROM sbom_records
     WHERE received_at >= $1
       AND received_at < $1 + INTERVAL '1 minute'
       AND normalisation_status = 'pending'`,
    [minute],
  );

  return {
    minute,
    top_services: servicesResult.rows.map((row) => ({
      name: row.name,
      count: Number(row.count),
    })),
    error_breakdown: errorResult.rows.map((row) => ({
      error_type: row.error_type,
      count: Number(row.count),
      pct: Number(row.pct),
    })),
    pending_count: Number(pendingResult.rows[0]?.pending_count ?? 0),
  };
}
