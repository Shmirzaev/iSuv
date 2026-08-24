# ADR-0011: Truthful operational signals and local recovery boundary

- Status: Accepted
- Date: 2026-08-24

## Context

Operational monitoring must distinguish source time from receipt time, communication from data trust, and missing projections from explicit no-data facts. A failed metrics dependency must not look like a healthy system full of zeroes. The local MVP also needs a repeatable recovery drill without implying that a single-host Compose archive is a government disaster-recovery design.

## Decision

- Durable telemetry receipt time is the first observation revision's `ingested_at`; source age uses the immutable lineage `observed_at`. The two lag series remain separate and are omitted when no corresponding fact exists.
- Device connection, fault, and data-condition metrics use fixed low-cardinality states. An absent current-health projection is `unconfigured`, never online, normal, or no-data. Water values and asset, territory, user, and request identifiers are not metric labels.
- Durable observation and alarm-evaluation counts come from PostgreSQL. Bounded route-template API errors and request outcomes are process-local counters that reset on restart and require an external scraper for retention.
- A database-backed metrics scrape fails with HTTP 503 and no fabricated operational values. Process liveness remains independent at `/health/live`; readiness checks the database and recovers without an API restart.
- The local backup drill accepts only validated PostgreSQL identifiers, refuses existing archive/restore targets and incomplete repository migration history, restores a custom-format archive into a distinct database, compares migration/inventory/audit evidence, and cleans only the exact target it created. Stored database functions needed while restoring data must bind extension dependencies without relying on the restore session's search path.
- Local recovery timing is engineering evidence only. Production monitoring, encrypted off-host retention, HA/DR topology, and authority-approved RPO/RTO remain external deployment decisions.

## Alternatives considered

- Exporting per-device or per-sensor metric labels; this creates unnecessary cardinality and identifier disclosure.
- Emitting zeroes when PostgreSQL is unavailable; this makes unknown operational state look normal.
- Treating every missing projection as offline or no-data; this invents device and data evidence.
- Using only volume snapshots or restoring over the source; neither proves a portable, safe restore.
- Claiming local smoke timings as production service objectives; no production infrastructure or authority-approved objective exists.

## Consequences

- Operators can distinguish delivery delay, source clock skew, communication state, numerical trust, and unconfigured evidence without mixing water quantities.
- Metrics are intentionally aggregate and approximate across sequential database reads, not a forensic snapshot.
- Process counters reset on restart; a production monitoring system must scrape and retain them.
- The recovery drill fails closed on stale schemas and may reveal restore-time database-function defects before handover.
- Production observability, backup retention, and disaster recovery remain rollout dependencies rather than hidden MVP claims.

## Verification

- Unit tests cover bounded labels, absent-data omission, process outcomes, and database-scrape 503 behavior.
- A rollback-only PostgreSQL smoke ingests 249 canonical readings across 83 synthetic devices, replays idempotently, reports throughput, and proves exact post-rollback source counts.
- The readiness drill proves `200 -> 503 -> 200` while structured logs retain request IDs and a safe dependency error.
- A current 20-migration custom-format backup restores into a distinct database, reproduces 83 stations, 83 devices, and the immutable audit fingerprint, then removes only its exact target; an outdated source is refused before archive creation.
