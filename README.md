# sbom-service

Ingests Software Bills of Materials (SBOMs) from service team CI/CD pipelines, scans for known vulnerabilities via a local [OSV.dev](https://osv.dev) mirror, tracks dependency freshness and release cadence, and serves a GOV.UK-styled dashboard for cross-government visibility.

## What it does

- Accepts CycloneDX and SPDX SBOMs via authenticated API endpoint
- Normalises components and stores in PostgreSQL
- Matches against OSV.dev vulnerability data (synced every 6 hours from GCS)
- Tracks release cadence from SBOM submission frequency
- Assesses dependency freshness via a configurable watchlist (`src/freshness/watchlist.yaml`) using data from [endoflife.date](https://endoflife.date), the npm registry, and Maven Central — colour-coded green/amber/red based on majors behind and EOL status
- Serves a GOV.UK Frontend dashboard behind OIDC SSO

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) (see `packageManager` in package.json)
- [Docker](https://www.docker.com/) (for local PostgreSQL, LocalStack S3, and OIDC mock)
- [gitleaks](https://github.com/gitleaks/gitleaks) (pre-commit secret scanning)
- [zizmor](https://github.com/zizmorcore/zizmor) (GitHub Actions security audit)

## Setup

```bash
git clone <repo-url>
cd sbom-service
pnpm install
pnpm run prepare
```

## Running locally

Start backing services:

```bash
docker compose up postgres localstack oidc-mock -d
```

Create the S3 bucket (one-time):

```bash
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
  aws --endpoint-url=http://localhost:4566 s3 mb s3://vodg-sbom-local --region eu-west-2
```

Configure environment and run:

```bash
cp .env.example .env
pnpm run db:migrate
pnpm run dev:watch
```

The service will be available at `http://localhost:3000`.

### Docker Compose

To run the full stack (including the service itself) in Docker:

```bash
docker compose up --build
```

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm run build` | Compile TypeScript to `/dist` |
| `pnpm run dev` | Start development server |
| `pnpm run dev:watch` | Start with file watching (auto-restart) |
| `pnpm run start` | Run compiled production build |
| `pnpm run lint` | Run ESLint + Prettier |
| `pnpm run test` | Run Jest unit tests |
| `pnpm run test:e2e` | Run Playwright E2E tests |
| `pnpm run db:migrate` | Run database migrations |
| `pnpm run generate-key` | Generate an API key for a service |

## Pushing SBOMs from CI

See [`sample-github-action/sbom-push.yml`](sample-github-action/sbom-push.yml) for a GitHub Actions workflow that fetches an SBOM from the GitHub dependency graph API and submits it to this service.

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  CI Pipeline │────▶│ Ingest API   │────▶│  S3 (raw SBOM)  │
└─────────────┘     └──────────────┘     └─────────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │   pg-boss    │
                    │  job queue   │
                    └──────────────┘
                      │         │
              ┌───────┘         └───────┐
              ▼                         ▼
    ┌──────────────────┐     ┌──────────────────┐
    │  Normalise job   │     │  Scan job        │
    │ (CycloneDX/SPDX)│     │ (OSV matching)   │
    └──────────────────┘     └──────────────────┘
              │                         │
              ▼                         ▼
    ┌──────────────────────────────────────────┐
    │              PostgreSQL                    │
    │  (services, components, vulnerabilities)  │
    └──────────────────────────────────────────┘
              │
              ▼
    ┌──────────────────┐
    │  Express server  │
    │  GOV.UK Frontend │
    │  (OIDC SSO auth) │
    └──────────────────┘
```

### Scheduled jobs

| Job | Schedule | Description |
|-----|----------|-------------|
| `sync-osv` | Every 6 hours | Downloads vulnerability data from OSV.dev GCS bucket (npm, PyPI, Go, Maven, NuGet, crates.io, Packagist) |
| `freshness-sync` | Daily at 3 AM | Evaluates watchlist packages against endoflife.date, npm registry, and Maven Central |

## Environment variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode | `development` |
| `PORT` | Server port | `3000` |
| `APP_URL` | Public-facing URL of the service | `http://localhost:$PORT` |
| `DATABASE_HOST` | PostgreSQL host | — |
| `DATABASE_PORT` | PostgreSQL port | `5432` |
| `DATABASE_USER` | PostgreSQL user | — |
| `DATABASE_PASSWORD` | PostgreSQL password | — |
| `DATABASE_NAME` | PostgreSQL database name | — |
| `DATABASE_URL` | Full connection string (alternative to individual vars) | — |
| `S3_BUCKET_NAME` | S3 bucket for raw SBOM storage | — |
| `S3_REGION` | AWS region for S3 | `eu-west-2` |
| `S3_ENDPOINT` | S3 endpoint override (for LocalStack) | — |
| `OSV_API_URL` | OSV.dev API URL | `https://api.osv.dev` |
| `MAX_PAYLOAD_BYTES` | Maximum SBOM upload size | `10485760` (10 MB) |
| `OIDC_ISSUER_URL` | OIDC provider issuer URL | — |
| `OIDC_CLIENT_ID` | OIDC client ID | — |
| `OIDC_CLIENT_SECRET` | OIDC client secret | — |
| `OIDC_REDIRECT_URI` | OIDC callback URL | — |
| `SESSION_SECRET` | Express session secret (≥32 chars in production) | — |

## CI/CD

GitHub Actions CI runs on PRs and pushes to `main`:

- **gitleaks** — secret scanning
- **zizmor** — GitHub Actions security audit
- **commitlint** — conventional commit message validation
- **lint** — ESLint + Prettier
- **test** — Jest unit tests
- **build** — Docker image build and push to GHCR (on main only)

## Licence

Released under the [Open Government Licence v3.0](LICENSE).
