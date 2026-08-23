# Repository Baseline

Recorded on 2026-08-23 for task P0-001.

## Git baseline

- Branch: `main`, tracking `origin/main`.
- Baseline commit: `409668f` (`Add Codex orchestration and water platform context`).
- History contains only the repository bootstrap/context commits.
- No application source, package manifest, database schema, migrations, containers, tests, CI, or runtime configuration existed at the baseline commit.
- The research PDF was rendered only for read-only inspection under ignored `tmp/` workspace storage; it is not product code.

## Existing assets to preserve

- Product and domain source material in `docs/`.
- Acceptance-driven task graph in `TASKS.md`.
- Project operating contract and bounded project-agent definitions in `AGENTS.md` and `.codex/agents/`.
- Accepted scope boundaries: monitoring/decision support only and distinct stage, discharge, and volume quantities.
- External-input blockers B-001 through B-004.

## Available local toolchain

- Node.js 24.19.0.
- npm 11.17.0.
- pnpm 11.19.0.
- Docker 29.6.1 and Docker Compose 5.1.4.
- Bundled Codex Python and document/PDF runtimes are available, but no project Python runtime is selected.

## Baseline risks and implications

- This is greenfield implementation work; there is no sound application stack to preserve or migrate.
- Every MVP-required criterion is initially unimplemented.
- Architecture must remain a small modular deployment; distributed services, brokers, caches, and specialized time-series infrastructure require evidence before adoption.
- Synthetic geometry, topology, rating curves, telemetry, allocation plans, and policy thresholds must remain conspicuously non-authoritative.
- Domain implementation must make incomplete or unreliable coverage explicit and must not infer leakage, theft, or operational safety from a residual alone.

## Audit evidence

- `git status --short --branch`
- `git log --oneline --decorate -12`
- `git ls-tree -r --name-only HEAD`
- `rg --files --hidden -g '!/.git/**'`
- `node --version`, `npm --version`, `pnpm --version`
- `docker --version`, `docker compose version`
- Read-only architecture and hydrology specialist audits reported no application code and enumerated the foundation/domain verification requirements.
