# SBOM Service

## Overview

TypeScript/Node.js service that ingests SBOMs (CycloneDX + SPDX), scans for vulnerabilities via a local OSV.dev mirror, tracks dependency freshness and release cadence, and serves a GOV.UK-styled dashboard. Part of the View of Digital Government (VODG) project.

## Architecture

- Express server + pg-boss worker (single process)
- Ingest: `POST /api/modules/sbom/services/:service_id` (X-API-Key auth, SHA-256 hashed)
- Normalisation: parses CycloneDX/SPDX, extracts components into PostgreSQL
- Scanner: queries local OSV mirror for vulnerability matches
- OSV Sync: downloads ecosystem ZIPs from GCS every 6h
- Freshness: evaluates dependency age against endoflife.date, npm registry, and Maven Central. Watchlist-driven (`src/freshness/watchlist.yaml`). Daily sync at 3 AM via pg-boss cron. States: green/amber/red based on majors behind + EOL status.
- Cadence: monitors SBOM submission frequency
- Dashboard: GOV.UK Frontend v6, Nunjucks templates, OIDC SSO auth

## Running locally

```bash
docker compose up postgres localstack oidc-mock -d
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test aws --endpoint-url=http://localhost:4566 s3 mb s3://vodg-sbom-local --region eu-west-2
cp .env.example .env
pnpm install
pnpm run db:migrate
pnpm dev:watch
```

## Package manager

pnpm (v10.33.0). Node 20+ required (see `.nvmrc`).

## Key files

- `src/main.ts` — entrypoint (Express + pg-boss)
- `src/config.ts` — environment configuration loader
- `src/ingest/router.ts` — SBOM ingest endpoint
- `src/normalise/` — CycloneDX + SPDX parsers
- `src/scanner/` — vulnerability matching against local OSV mirror
- `src/sync/` — OSV.dev data sync (downloads ecosystem ZIPs from GCS)
- `src/freshness/` — dependency freshness analysis
- `src/cadence/` — release cadence tracking
- `src/server/routes/` — Express routes (admin, dashboard, services)
- `src/db/migrations/` — PostgreSQL schema migrations

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm run build` | Compile TypeScript to /dist |
| `pnpm run dev` | Start development server |
| `pnpm run dev:watch` | Start with file watching |
| `pnpm run lint` | ESLint + Prettier |
| `pnpm run test` | Jest unit tests |
| `pnpm run test:e2e` | Playwright E2E tests |
| `pnpm run db:migrate` | Run database migrations |
| `pnpm run generate-key` | Generate API key for a service |

## Docker

Multi-stage Dockerfile: build stage (pnpm install + tsc), release stage (prod deps only). Base: `node:20-slim`.

## TypeScript conventions

- `strict: true` — no implicit any
- ESM-style imports compiled to CommonJS
- Collocated tests (`*.test.ts` alongside source)
- Jest with `ts-jest` and `--experimental-vm-modules`

## OSV Sync

Ecosystems: npm, PyPI, Go, Maven, NuGet, crates.io, Packagist
Schedule: every 6 hours (pg-boss cron)
Data source: `https://osv-vulnerabilities.storage.googleapis.com/{ecosystem}/all.zip` (public, no auth)
