# Local operations and recovery

This is a local, synthetic-data MVP. The procedures here are deliberately limited to the Docker Compose PostgreSQL service and do not authorize production deployment, real telemetry, OT connectivity, or physical control.

## Local persistence and recovery drill

`postgres-data` is the only named local persistence volume. Copy `.env.example` to `.env`, set a unique local-only password, and start PostgreSQL before running a drill. The following command creates a PostgreSQL custom-format archive, restores it into a new database, compares migration and synthetic inventory counts, and compares a stable fingerprint of immutable audit records. It never drops or overwrites the source database or an existing archive.

```powershell
pwsh -File scripts/backup-restore-smoke.ps1 -Cleanup
```

The archive defaults to a timestamp-and-GUID-specific file under `tmp/`, which is ignored by Git. An existing `-BackupPath` is always refused rather than overwritten. The restore database name is generated with a timestamp and must differ from the source; an existing target is refused. `-Cleanup` is an explicit request to remove only that newly created restore database after verification. Omit it to retain the target for inspection.

The source defaults to the Compose `POSTGRES_DB`. The drill compares its complete applied migration-name set with `apps/api/migrations` and refuses to certify an outdated or partially migrated source. A separately named local database may be selected explicitly with `-SourceDatabase`; identifiers remain validated and the source is never modified.

To choose a retained target or archive location:

```powershell
pwsh -File scripts/backup-restore-smoke.ps1 `
  -BackupPath .\tmp\isuv-drill.dump `
  -SourceDatabase isuv `
  -RestoreDatabase isuv_restore_drill_20260824
```

The procedure invokes `pg_dump` and `pg_restore` inside the running PostGIS container, then uses `docker cp` for the binary archive. It therefore needs no host PostgreSQL client and does not pass the archive through a text pipe. A unique temporary archive is removed from the local database volume in a `finally` block. The archive can contain synthetic operator records; keep it local, encrypted where applicable, and out of source control.

Local engineering expectation: a developer can recover a small synthetic dataset within one working session (target RPO is the time since the last manually run archive; target RTO is the time to run the drill plus local container startup). These are not production commitments. Production requires an approved backup schedule, off-host encrypted storage, retention/legal-hold policy, monitored restore exercises, separately provisioned migration/runtime roles, and a disaster-recovery RPO/RTO approved by the water authority.

P7 verification on the local development workstation observed 7.64–9.35 seconds for a rollback-only 249-reading ingestion batch across 83 devices (26.64–32.61 readings/second), about 19 seconds for the current 20-migration custom-format backup/restore/verification drill, and 5 seconds for readiness degradation and recovery. These bounded synthetic observations are diagnostic evidence, not capacity, availability, RPO, or RTO commitments.

## Health, readiness, logs, and metrics

- `GET /health/live` proves that the API process can answer without database access.
- `GET /health/ready` checks PostgreSQL connectivity, returning 503 while the dependency is unavailable and 200 when it recovers.
- `GET /metrics` exposes low-cardinality, database-backed operational metrics: database readiness; receipt and source lag; explicit device connection, data, and fault state; validation and alarm outcomes; and API errors. A failed database scrape returns 503 rather than fabricating zero-valued operational metrics.
- API error, ingestion-outcome, and validation-outcome counters are process-local and reset when the API restarts; durable observation and alarm-run totals remain database-backed. Production monitoring must scrape and retain time series externally.
- Each response returns `x-request-id`. Fastify structured logs include the same request identifier; use it to connect an operator-visible failure, server log event, and an audited mutation. Request IDs are correlation metadata, never identity or authorization evidence.

The unit-level readiness contract is run by `pnpm --filter @isuv/api test -- src/app.test.ts`. For a running local API, the explicit interruption drill below proves the external transition without changing data or removing a volume:

```powershell
pwsh -File scripts/p7-readiness-recovery-smoke.ps1 -AllowServiceInterruption
```

It stops only the Compose `postgres` service, expects `200 -> 503 -> 200`, and always attempts to restart it. Do not run it while another local user depends on that database.

## Failure boundaries

- Missing `.env`, unavailable Docker, stopped PostgreSQL, or an unavailable API cause the scripts to stop with an actionable error; they do not fall back to a remote host.
- Backup verification fails closed if migration/synthetic inventory/audit fingerprint data differs. It also refuses an existing archive or restore target. Without `-Cleanup`, the restored database is retained for investigation.
- The restore script refuses an existing target and validates PostgreSQL identifier inputs. It does not use `--clean`, `docker compose down --volumes`, or any command that removes the source database/volume.
- Compose binds PostgreSQL to loopback and runs with dropped capabilities plus `no-new-privileges`. The local bootstrap account/password in `.env` is disposable development scaffolding, not a production security model.
- No adapter or endpoint controls gates, pumps, valves, PLCs, or RTUs. Official operational data, credentials, backup destinations, monitoring, and recovery objectives remain external rollout dependencies.
