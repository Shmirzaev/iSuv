# iSuv Regional Water Platform

This repository is the local, synthetic-data MVP for regional water monitoring and decision support. It contains no real device credentials and **does not provide physical control** of gates, pumps, valves, PLCs, or RTUs.

## Prerequisites

- Node.js 24.x (Corepack enabled)
- Docker Desktop with Docker Compose v2

## Clean-checkout startup

```sh
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env # PowerShell: Copy-Item .env.example .env
# replace the local-only placeholder password in .env
docker compose --env-file .env up -d postgres
docker compose ps
pnpm db:migrate
pnpm db:seed
pnpm dev
```

The API listens on `http://127.0.0.1:3000`; the operator shell is served by Vite at `http://127.0.0.1:5173`. The shell is intentionally and visibly marked as synthetic data. Stop local services with `docker compose down`; its named volume keeps database state. To remove that state intentionally, run `docker compose down --volumes`.

The synthetic telemetry simulator is deliberately disabled by default and always refused when `NODE_ENV=production`. For an explicit local demonstration, enable both local identity and the simulator before starting the API (PowerShell example):

```powershell
$env:ISUV_ENABLE_LOCAL_IDENTITY = 'true'
$env:ISUV_ENABLE_SYNTHETIC_SIMULATOR = 'true'
pnpm dev
```

Authenticated `GET /api/v1/telemetry/simulator/preview` and `POST /api/v1/telemetry/simulator/run` requests accept a bounded scenario request. The seeded system administrator ID is `a3000000-0000-4000-8000-000000000001` and is supplied locally through `x-isuv-user-id`. All simulator output is synthetic, raw, and unsuitable for accounting until the governed validation workflow approves it.

## Verification and smoke checks

```sh
pnpm verify
curl http://127.0.0.1:3000/health/live
curl http://127.0.0.1:3000/health/ready
curl http://127.0.0.1:3000/metrics
pnpm db:migrate && pnpm db:seed && pnpm db:seed
```

`pnpm verify` runs formatting, linting, TypeScript project checks, unit tests, and production builds. The `POSTGRES_PASSWORD` in `.env` is local-only and must never be used outside a developer machine.

## Persistence, backup, and restore

The Compose `postgres-data` named volume is explicit local persistence. Create a portable backup while the service is running:

```sh
docker compose --env-file .env exec -T postgres pg_dump -U isuv_app -d isuv -Fc > isuv-local.dump
```

Restore only into a deliberately disposable local database:

```sh
Get-Content isuv-local.dump -AsByteStream | docker compose --env-file .env exec -T postgres pg_restore -U isuv_app -d isuv --clean --if-exists
```

Backups may contain operational records in later phases; encrypt and retain them under the applicable policy. Restore overwrites matching objects, so never use it against an environment containing authoritative data.

## Failure modes and boundaries

- `/health/live` reports process liveness; `/health/ready` reports database connectivity and returns 503 when PostgreSQL is unavailable.
- Fastify assigns each API request an ID, preserves a supplied `x-request-id`, returns it in the response, and includes it in structured request logs.
- Migrations are tracked transactionally; rerunning migration and seed is safe.
- API health and metrics bind locally by default. Compose binds PostgreSQL only to loopback. This MVP has no OT adapter or command route.
- The local database is loopback-only and uses a disposable bootstrap account inside the isolated container. The container drops all Linux capabilities except those required by the official image for initialization and user switching, and it disallows privilege escalation. A production deployment must provision separate migration and least-privilege runtime roles; this Compose file is not a production hardening or backup policy.
