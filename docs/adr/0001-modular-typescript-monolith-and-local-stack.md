# ADR-0001: Modular TypeScript Monolith and Local Stack

- Status: Accepted
- Date: 2026-08-23
- Owners: Primary agent

## Context

The repository is a greenfield context pack. The MVP needs typed APIs, deterministic water-domain calculations, a responsive operator application, geospatial topology, migrations, tests, and repeatable local startup. The initial 83 synthetic hotspots do not justify distributed-service operational complexity.

## Decision

Use one pnpm TypeScript workspace with these dependency boundaries:

- `apps/api`: Fastify HTTP/SSE application and composition root;
- `apps/web`: React/Vite operator application;
- `packages/contracts`: transport-neutral Zod schemas and inferred API types;
- `packages/domain`: pure topology, quantity, accounting, quality, and alarm logic with no dependency on transport, persistence, or UI;
- `packages/i18n`: shared Uzbek, Russian, and English vocabulary where cross-surface reuse is needed.

Deploy the MVP as a modular monolith backed by PostgreSQL with PostGIS through Docker Compose. Use SQL migrations and a lightweight typed query layer that does not hide PostgreSQL constraints or PostGIS capabilities. Keep modules for identity, topology, telemetry, allocations, alarms, incidents, reports, and audit inside the API process until measured scale or operational ownership justifies extraction.

The dependency direction is `apps -> contracts/domain`; domain packages must not depend on Fastify, React, database clients, or browser code. No Kafka, Redis, TimescaleDB, or independently deployed microservices are introduced without measured need and a new decision.

## Alternatives considered

- Multiple microservices with a broker: rejected for premature distributed complexity, consistency cost, and a larger local/operational surface.
- A Next.js full-stack application: workable, but rejected because an explicit API/SSE boundary and independently testable operator client better match future government integrations.
- Python API plus TypeScript UI: workable, but rejected for the MVP because a single language reduces contract/tooling duplication without weakening the deterministic domain boundary.
- SQLite-only persistence: rejected because PostGIS, concurrent operational workflows, and PostgreSQL-native integrity constraints are acceptance-relevant.

## Consequences

- Local development requires Node.js, pnpm, Docker, and Docker Compose.
- PostgreSQL is the authoritative operational store for the MVP; object/document storage remains behind an interface until report or evidence files require a separate implementation.
- Tests can exercise pure domain logic without infrastructure and database invariants through integration tests.
- Service extraction remains possible at module/adapter boundaries, but is not an MVP objective.

## Verification

- Workspace checks enforce package boundaries and TypeScript project references.
- Docker Compose validates and starts PostgreSQL/PostGIS with health checks.
- Migrations and idempotent seed run twice successfully.
- API readiness and web production builds pass from documented commands.
