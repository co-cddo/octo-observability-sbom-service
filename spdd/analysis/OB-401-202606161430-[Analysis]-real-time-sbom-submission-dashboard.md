# SPDD Analysis: Implement Real-Time SBOM Submission Monitoring Dashboard

**Original Jira Issue:** [OB-401](https://gds-digital-transformation.atlassian.net/browse/OB-401)

**Issue Summary:** [STORY-400] Implement Real-Time SBOM Submission Monitoring Dashboard

**Issue Type:** Story

**Created:** 2026-06-15

---

## Original Jira Story

### Background

SBOM submission volumes and error rates are currently opaque to ops teams. When submissions fail or latencies spike, there's no real-time visibility to diagnose the issue or escalate appropriately. A real-time dashboard providing volume trends, error rates, and drill-down into failures would enable faster incident response and capacity planning.

Key points:

* Ops teams need immediate visibility into submission health
* Operators currently rely on log parsing to diagnose failures — manual and slow
* Dashboard will enable proactive alerting and troubleshooting across all GitHub repositories

### Business Value

* Provide **real-time submission volume and error rate visibility** for ops teams
* Support **rapid incident detection** — spot volume spikes or error surges within seconds
* Enable **data-driven capacity planning** — identify high-load repos and submission patterns
* Reduce **mean-time-to-detect (MTTD)** submission health issues from hours to seconds

### Dependencies and Assumptions

* **Prerequisites**: SBOM submission API is instrumented with success/failure metrics and submission count events
* **Data assumptions**: Metrics are being collected and available via a backend query API (Prometheus, CloudWatch, or similar)
* **Integration points**: Dashboard reads from observability backend (metrics API); displays in web UI alongside existing Octo Observability dashboards
* **Business constraints**: Must support 100+ GitHub repositories; dashboard must be readable during high-volume periods (no slow rendering)

### Scope In

* **Dashboard view**: Real-time line chart showing submission volume (successful submissions per minute) and error rate (%) over the last 24 hours
* **Drill-down capability**: Click on a spike to see details: which repos drove the spike, breakdown by error type (rate limit, validation failure, auth, timeout, etc.)
* **Refresh frequency**: Dashboard updates every 15–30 seconds (or when new data arrives)
* **Error type legend**: Visual legend explaining error categories and what each means (e.g., "rate limit" = GitHub API quota hit)
* **Mobile-responsive design**: Usable on desktop and tablet (primary use case is desktop ops terminal, secondary is mobile alerts)

### Scope Out

* **Alerting / notifications**: Automatic Slack/PagerDuty alerts (separate story)
* **Historical analysis**: Long-term trend analysis (>30 days) — separate query optimization story
* **Configuration UI**: Customizable thresholds or repo filtering (separate story; dashboard shows all repos by default)
* **Data retention policy**: Data archival or deletion logic (infrastructure concern; assume 30-day retention)

### Acceptance Criteria

#### AC1: Dashboard displays real-time submission volume

**Given** the dashboard is open in a browser and SBOM submissions are flowing through the GitHub action
**When** the user views the volume chart
**Then** the line chart shows submission count per minute, updated every 15–30 seconds, with current metrics visible within 1 minute of submission occurrence

#### AC2: Dashboard displays error rate trend

**Given** the dashboard is open and some submissions have failed
**When** the user views the error rate line
**Then** the dashboard shows error rate (failed submissions / total submissions × 100) as a percentage, updated every 15–30 seconds, and clearly distinguishes periods with 0% errors vs. elevated errors (e.g., red highlight >5% error rate)

#### AC3: Drill-down reveals repo-level breakdown

**Given** the user observes a volume spike on the volume chart
**When** the user clicks on the spike
**Then** a detail pane opens showing: which GitHub repos contributed to the spike (top 5 by submission count), and the submission count for each repo during that 1-minute window

#### AC4: Error type breakdown visible in drill-down

**Given** the user clicks on a spike with elevated error rate
**When** the detail pane opens
**Then** a breakdown table shows: error type, count, and percentage (e.g., "rate_limit: 23 (45%)", "validation_error: 18 (35%)", "auth_error: 10 (20%)")

#### AC5: Dashboard handles high-volume periods without lag

**Given** the system is receiving 1,000+ submissions per minute across all repos
**When** the dashboard is open and refreshing every 15–30 seconds
**Then** the UI remains responsive (click to drill-down takes <200ms), charts render without stutter, and no data points are dropped or delayed

#### AC6: Error types are clearly explained

**Given** the user is new to the system and sees the error type breakdown
**When** they hover over an error type label (e.g., "rate_limit")
**Then** a tooltip appears explaining the error (e.g., "GitHub API rate limit reached; submissions queued for retry")

#### AC7: Dashboard is responsive on tablet

**Given** the user opens the dashboard on a tablet in portrait orientation
**When** they view the charts and interact with drill-down
**Then** the layout adapts: chart stacks vertically, text remains readable, drill-down modal is usable with touch input

### Non-Functional Expectations

* Dashboard must load initial data and render within 2 seconds of page load
* Real-time updates must not add >50ms latency to backend query response time
* Dashboard must remain usable for at least 8 hours of continuous operation without memory leaks or page refresh required
* Browser support: Chrome, Firefox, Safari (latest two versions); mobile Safari on iPad

---

## Domain Concept Identification

### Existing Concepts (from codebase)

- **SbomRecord** (`sbom_records` table, `SbomRecord` interface in `src/db/queries.ts`): represents a single SBOM submission event. Core attributes: `id`, `service_id`, `received_at` (submission timestamp), `normalisation_status` ('pending' | 'complete' | 'failed'), `error_message` (nullable free text). This is the primary data source for volume and error rate metrics — every submission creates one row.

- **Service** (`services` table, `ServiceRow` interface): the submission endpoint in this system's domain model. Attributes: `id`, `name`, `slug`, `organisation`. In AC3's "top 5 repos by submission count", this refers to top-5 `services` by submission volume; services may not have any GitHub association.

- **NormalisationStatus** (value type in `sbom_records`): the proxy for submission success/failure. 'complete' = successful processing; 'failed' = error during normalisation; 'pending' = in-flight. For the dashboard, error rate = `failed / (complete + failed)` per minute bucket; pending records are excluded from rate calculation as they haven't yet resolved.

### New Concepts Required

- **SubmissionMetricsBucket**: a time-bucketed aggregation over `sbom_records`. Not yet represented in code. Attributes: `minute` (timestamp), `total_count`, `success_count`, `failed_count`, `pending_count`, `error_rate_pct`. Why new: the story requires charting volume and error rate per 1-minute interval over 24 hours — no existing query produces this; it requires `DATE_TRUNC('minute', received_at)` GROUP BY aggregation.

- **DrilldownWindow**: a point-in-time snapshot of which services contributed submissions in a specific 1-minute bucket and how failures broke down by type. Attributes: `minute`, `top_services [{ service_name, count }]`, `error_breakdown [{ error_type, count, pct }]`, `pending_count`. Why new: required to serve AC3 and AC4 from a click interaction; does not exist in any current query.

- **ErrorType**: a categorisation of submission failures. Currently not modelled — `error_message` in `sbom_records` is free text only. Required for AC4's typed breakdown (rate_limit, validation_error, auth_error, timeout, etc.). This concept represents a significant schema and ingest-side gap — see Risks section.

### Key Business Rules

- **Error rate threshold**: >5% error rate in a bucket should be visually highlighted (AC2). Not yet implemented anywhere.
- **Submission "failure" means normalisation failure**: a submission that is received (HTTP 202) but fails during async normalisation (pg-boss job) is the failure case. HTTP-level ingest rejections (malformed SBOM, bad API key) are not currently persisted to `sbom_records` at all — they return 400/401 before a row is written.
- **Processing state visibility**: when all submissions in a time bucket are still `pending`, the error rate is undefined. Show a "processing" indicator rather than 0% error rate (AC2 clarification).

---

## Strategic Approach

### Solution Direction

Build new monitoring routes and a Nunjucks view within the existing Express app, querying `sbom_records` directly via PostgreSQL aggregations. Use polling (30s `setInterval`) from the frontend to a new JSON API endpoint rather than a metrics middleware or separate observability backend. Query pattern: `DATE_TRUNC('minute', received_at)` with status grouping; classify error types via `CASE WHEN error_message ILIKE '%...'%` pattern matching in the SQL.

For Chart.js: check if jsDelivr CDN (`https://cdn.jsdelivr.net/npm/chart.js`) can be added to the CSP `script-src` allowlist (ask team). If not, self-host in `public/javascripts/`. The `bodyEnd` block in `layout.njk` can load either URL — same nonce injection pattern works.

### Key Design Decisions

- **Polling vs WebSocket for real-time updates**: AC1/AC2 require "visible within 1 minute" and "updated every 15–30 seconds". WebSocket is lower-latency but substantially more complex. A 30s `setInterval` JSON poll satisfies both ACs and aligns with the existing dashboard's architecture (server-rendered HTML + no real-time mechanisms). → **Polling at 30s interval**.

- **Data source — PostgreSQL vs separate metrics API**: The story mentions "Prometheus, CloudWatch or similar", but actual data is already in `sbom_records` in PostgreSQL with timestamps and status. Introducing a separate metrics layer adds infrastructure complexity with no benefit for this scope. → **Query `sbom_records` directly** (confirmed acceptable by team).

- **Error type classification — pattern matching vs schema migration**: AC4 requires named error types, but `error_message` is free text and no `error_type` column exists. A schema migration + ingest-layer changes would be correct long-term but out of scope. → **ILIKE pattern matching on `error_message` for initial delivery**; surface as interim with follow-up story for structured `error_type` column.

- **Chart library — Chart.js CDN or self-hosted**: jsDelivr CDN is a known, trusted source used by many projects. → **Try CDN first (add to CSP); fall back to self-host in `public/javascripts/` if CDN cannot be whitelisted**. The `bodyEnd` block in `layout.njk` can load either URL with nonce injection.

- **Drill-down UX — inline panel**: GOV.UK Frontend has no modal component. An inline detail panel (shown below charts when clicked, dismissed with a close button) is more accessible and avoids focus-trap complexity. → **Inline collapsible panel**, styled with GOV.UK card/summary patterns.

### Alternatives Considered

- **Separate `/monitoring` route vs. tab within existing `/dashboard`**: A separate route keeps monitoring concerns isolated; `/monitoring` URL can be bookmarked and shared. Mixing with service-health data (current dashboard) would be confusing. → Separate route chosen.
- **Server-Sent Events (SSE)**: Lower overhead than WebSocket, simpler. But adds a long-lived connection per browser tab, complicating load balancer/proxy config. Polling is simpler and sufficient. → Rejected.

---

## Risk & Gap Analysis

### Requirement Ambiguities

- **"Real-time" definition**: AC1 says "visible within 1 minute"; Background says "within seconds". **Resolved**: 30s poll cycle is acceptable.

- **"Failed submission" scope**: Should ingest-layer HTTP failures (400/401, never written to DB) be surfaced? **Resolved**: No. Other monitoring will catch them.

- **Data source**: Story dependencies mention Prometheus/CloudWatch. **Resolved**: PostgreSQL `sbom_records` query is acceptable; no external metrics backend needed (confirmed).

- **"Repos" vs `services`**: Story uses "GitHub repos"; schema uses `services`. **Resolved**: "Repos" in drill-down refers to `services` (submission endpoints). Services may not have GitHub association at all.

### Edge Cases

- **All-pending records in a time bucket**: If all submissions in a minute are `pending`, error rate = undefined. **Resolved**: Show "processing" indicator in drill-down; exclude pending from error rate denominator.

- **No submissions in a time bucket**: A gap in the chart should render as 0 volume and `null` error rate (not 0%). Chart.js handles `null` as gaps in the line.

- **Drill-down click on zero-volume bucket**: Show "No submissions in this window" rather than empty tables.

### Technical Risks

- **Error type classification via pattern matching is fragile**: Using `ILIKE` on `error_message` to classify into `rate_limit`, `validation_error`, `auth_error`, `timeout` will break if error messages change in normaliser code or new types are added without updating the SQL CASE. **Highest risk for AC4 fidelity**. Mitigation: document as interim; raise follow-up story to add structured `error_type` column at ingest layer with explicit whitelist.

- **Query performance**: With max 1,000 services submitting once/day, peak load ~12 submissions/minute. 24h scan = ~17,280 rows — negligible. Existing `idx_sbom_records_service_received` index sufficient; no new index needed.

- **Chart.js CDN availability & CSP**: jsDelivr is reliable, but adding it to CSP requires policy change. Fallback: self-host in `public/javascripts/`. Same Nunjucks injection pattern works for both. → **Action**: Try CDN first, implement self-host as fallback.

- **No route test infrastructure**: No supertest or integration test pattern established. New routes should have tests; test setup (supertest + mock pool) will need to be built from scratch. Not a blocker, but adds effort.

- **Memory leak risk (NFR)**: Frontend `setInterval` polling loop without cleanup would accumulate timers on long page opens. This is a server-rendered MPA (not SPA), so navigation destroys the JS context — risk is lower. Should test via browser memory profiler on the monitoring route.

### Acceptance Criteria Coverage

| AC# | Description | Addressable? | Notes |
|-----|-------------|--------------|-------|
| AC1 | Real-time volume line, updated 15–30s | Yes | 30s poll of `/api/monitoring/metrics`; 1-min buckets from `sbom_records` |
| AC2 | Error rate line, >5% highlight | Yes | Error rate from `failed / (failed + complete)`; red styling via Chart.js |
| AC3 | Drill-down: top 5 services by submission count | Yes | Click posts selected minute to `/api/monitoring/drilldown`; returns `services.name` + count |
| AC4 | Error type breakdown in drill-down | Partial | Pattern-matching on `error_message` interim; fidelity depends on message content — see Risk above |
| AC5 | Performant at high volume | Yes | Expected load ~12/min; query negligible; Chart.js renders instantly |
| AC6 | Tooltips explaining error types | Yes | GOV.UK `title` attributes or Chart.js tooltip plugin; error taxonomy in frontend |
| AC7 | Responsive on tablet | Yes | GOV.UK grid system; vertical stack on narrow viewport via media queries |

---

## Implementation Outline

### Backend

**New query functions in `src/db/queries.ts`:**

- `getSubmissionMetrics(pool, windowHours)` — returns array of `{ minute, total, success, failed, pending, errorRatePct }` buckets over last N hours, grouped by `DATE_TRUNC('minute', received_at)`.
- `getDrilldownData(pool, minute)` — returns `{ minute, topServices: [{ name, count }], errorBreakdown: [{ type, count, pct }], pendingCount }` for a specific minute bucket; classifies error types via `CASE WHEN error_message ILIKE '%...' % THEN 'type'` pattern.

**New routes in `src/server/routes/monitoring.ts`:**

- Factory `monitoringRouter(pool): Router`.
- `GET /` — renders `monitoring.njk` with initial 24h metrics embedded; Chart.js loads via Nunjucks with nonce.
- `GET /api/metrics` — JSON endpoint returning metric buckets; called by frontend `setInterval` polling.
- `POST /api/drilldown` — JSON endpoint accepting `{ minute }` query param; returns drill-down data for that minute.
- All handlers have `requireAuth()` middleware; all use try/catch with error responses.

**Mount in `src/server/app.ts`:**

```typescript
app.use("/monitoring", requireAuth(), monitoringRouter(pool));
```

### Frontend

**New view `src/server/views/monitoring.njk`:**

- Extends `layout.njk`.
- Renders two Chart.js line charts (volume, error rate) with 24h initial data.
- Drill-down detail panel (initially hidden, shown on chart click).
- `<script type="module">` with nonce: polling loop (30s), click handler, chart updates.
- GOV.UK grid layout; responsive design (vertical stack on mobile).
- Error type legend with tooltips.

**New stylesheet** (inline or `src/server/views/monitoring.css`):

- Chart container sizing, grid layout, drill-down panel styling.
- Media queries for tablet/mobile.
- Highlight >5% error rate (red background or border).

**Update `src/server/views/layout.njk`:**

- Add nav link to `/monitoring` in the OIDC-authenticated nav.

### Build & Test

- `pnpm lint` — ESLint checks new files.
- `pnpm build` — TypeScript compiles cleanly.
- `pnpm test` — unit tests for `getSubmissionMetrics` and `getDrilldownData` (mock pool; test query results shape).
- Manual: `docker-compose up`, submit test SBOM, open `/monitoring`, confirm chart render and drill-down interaction.

---

## Next Steps

1. **Confirm Chart.js CDN allowlist**: Ask team if jsDelivr can be added to CSP. If no, add `chart.js` to `package.json` and copy to `public/javascripts/` via build script.
2. **Define error type taxonomy**: Map common `error_message` patterns to error types (rate_limit, validation_error, auth_error, timeout, unknown). Document in code.
3. **Implement backend queries and routes**: Follow existing patterns (factory functions, parameterised queries, try/catch).
4. **Implement frontend view and polling**: GOV.UK styling, Chart.js setup, polling loop with cleanup.
5. **Test**: manual dashboard open, data visibility, drill-down interaction, tablet responsiveness, 8h memory stability.
6. **Follow-up story**: Add structured `error_type` column to `sbom_records` at ingest layer for long-term AC4 fidelity.
