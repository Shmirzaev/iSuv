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
# replace both POSTGRES_PASSWORD and its matching DATABASE_URL password in .env
docker compose --env-file .env up -d --wait postgres
docker compose ps
pnpm build
pnpm db:migrate
pnpm db:seed
pnpm dev
```

The API listens on `http://127.0.0.1:3000`; the operator shell is served by Vite at `http://127.0.0.1:5173`. The shell is intentionally and visibly marked as synthetic data. Stop local services with `docker compose down`; its named volume keeps database state. To remove that state intentionally, run `docker compose down --volumes`.

The synthetic telemetry simulator is deliberately disabled by default and always refused when `NODE_ENV=production`. For an explicit local demonstration, enable both local identity and the simulator before starting the API (PowerShell example):

```powershell
$env:ISUV_ENABLE_LOCAL_IDENTITY = 'true'
$env:ISUV_ENABLE_SYNTHETIC_SIMULATOR = 'true'
$env:ISUV_WEB_LOCAL_USER_ID = 'a3000000-0000-4000-8000-000000000001'
pnpm dev
```

The `x-isuv-user-id` identity adapter is local/test tooling only and is unconditionally disabled when `NODE_ENV=production`, even if the enable flag is present. A deployment must inject its accredited OIDC/SAML/MFA-capable provider; browser-supplied roles are never authoritative.

`ISUV_WEB_LOCAL_USER_ID` is consumed only by Vite's local proxy and is not bundled into the browser. It demonstrates the shell with a seeded role while the API remains the authorization authority; omit it to exercise the fail-closed signed-out state. Authenticated `GET /api/v1/telemetry/simulator/preview` and `POST /api/v1/telemetry/simulator/run` requests accept a bounded scenario request. The seeded system administrator ID is `a3000000-0000-4000-8000-000000000001` and is supplied locally through `x-isuv-user-id`. All simulator output is synthetic, raw, and unsuitable for accounting until the governed validation workflow approves it.

## Verification and smoke checks

```sh
pnpm verify
pnpm --filter @isuv/api test:db
pnpm test:e2e
curl http://127.0.0.1:3000/health/live
curl http://127.0.0.1:3000/health/ready
curl http://127.0.0.1:3000/metrics
pnpm db:migrate && pnpm db:seed && pnpm db:seed
```

`pnpm build` creates the workspace package outputs required by the seed and runtime in a clean checkout. `pnpm verify` runs formatting, linting, TypeScript project checks, unit tests, and production builds. The serial database suite requires the migrated PostgreSQL service and `DATABASE_URL`; the Chromium smoke additionally starts the built API and Vite web service against that database. The `POSTGRES_PASSWORD` in `.env` is local-only, must match the password embedded in `DATABASE_URL`, and must never be used outside a developer machine.

## Persistence, backup, and restore

The Compose `postgres-data` named volume is explicit local persistence. Run the noninteractive backup/restore drill below to make a timestamp-and-GUID-specific binary archive, restore it into a distinct database, and verify migrations, 83 synthetic stations/devices, and immutable audit evidence. It refuses existing archive/restore targets and never overwrites the source database or removes a volume.

```powershell
pwsh -File scripts/backup-restore-smoke.ps1 -Cleanup
```

See [local operations and recovery](docs/OPERATIONS.md) for the retained-target option, recovery expectations, and failure boundaries. Backups may contain operational records; encrypt and retain them under applicable policy and never use this local procedure against authoritative data.

The durable [software MVP acceptance evidence](docs/ACCEPTANCE_EVIDENCE.md) maps every required criterion to implementation and verification paths and separates completed software scope from official rollout dependencies.

## Failure modes and boundaries

- `/health/live` reports process liveness; `/health/ready` reports database connectivity and returns 503 when PostgreSQL is unavailable. An explicit local `200 -> 503 -> 200` recovery drill is documented in [OPERATIONS.md](docs/OPERATIONS.md).
- Fastify assigns each API request an ID, preserves a supplied `x-request-id`, returns it in the response, and includes it in structured request logs.
- Migrations are tracked transactionally; rerunning migration and seed is safe.
- API health and metrics bind locally by default. Compose binds PostgreSQL only to loopback. This MVP has no OT adapter or command route.
- The local database is loopback-only and uses a disposable bootstrap account inside the isolated container. The container drops all Linux capabilities except those required by the official image for initialization and user switching, and it disallows privilege escalation. A production deployment must provision separate migration and least-privilege runtime roles; this Compose file is not a production hardening or backup policy.
