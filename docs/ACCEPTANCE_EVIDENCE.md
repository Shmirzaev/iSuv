# Software MVP acceptance evidence

This matrix is the durable handover for every section marked **MVP REQUIRED** in `docs/ACCEPTANCE_CRITERIA.md`. It verifies the local software MVP with clearly labeled synthetic/nonofficial data. It does not claim completion of the government rollout or authorize physical infrastructure control; the external inputs and approvals in section O remain open in `docs/BLOCKERS.md`.

## A. Repository and local environment — verified

- `README.md`, `.env.example`, and `compose.yaml` provide a clean-checkout Node 24/pnpm/PostGIS startup with loopback binding, matched local credentials, a health wait, repeatable migration/seed commands, and an isolatable volume/port.
- Root `package.json` exposes format, lint, type, security, test, build, migration, seed, serial database, and browser commands; `.github/workflows/verify.yml` runs frozen install, dependency audit, all static/unit/build gates, migration/seed replay, isolated backup/restore, serial PostgreSQL tests, and Chromium.
- `apps/api/src/app.ts` exposes process-only liveness, database readiness, and low-cardinality operational metrics. `scripts/backup-restore-smoke.ps1` and `scripts/p7-readiness-recovery-smoke.ps1` provide guarded local resilience checks.
- The final detached-worktree smoke evidence and exact cleanup are recorded in `TASKS.md` P7-004 and `docs/EXECUTION_LEDGER.md`.

## B. Domain and master data — verified

- Migrations `0002`–`0021` define typed organizations/territories/users/roles, regions/basins/waterways/junctions/sections/control structures/stations/devices/sensors, observation history, allocation plans, rules/alarms/incidents, maintenance records, reports, and audit events with stable UUIDs plus constrained human-readable codes where applicable.
- `0003_water_network_assets.sql` and `apps/api/src/modules/network/repository.db.test.ts` enforce directed topology, organization/territory integrity, geometry validity, stable codes, and concurrency-safe cycle prevention.
- `apps/api/src/db/syntheticNetworkSeed.ts` generates exactly 83 clearly synthetic connected hotspot roots, 83 stations/devices/installations, and 249 canonical sensors. Unit and database seed tests prove deterministic, repeatable coverage.
- The shell, operational views, analytics, and report contracts preserve `synthetic`/`official: false` provenance; UI and browser tests assert visible nonofficial disclosure.

## C. Measurement integrity — verified

- `0005_observation_revisions.sql`, observation contracts/domain code, and API services keep stage `m`, instantaneous discharge `m3/s`, and accumulated/interval volume `m3` as separate closed quantity/unit pairs. Every lineage/revision retains source and ingestion time, device/sensor/installation identity, quality, provenance, and correction history.
- Observation, telemetry, and validation database tests cover canonical idempotency, conflicting duplicate delivery, microsecond-safe late/out-of-order facts, stale/frozen/impossible/missing data, raw/estimated/valid/corrected states, concurrent correction, and atomic audit without rewriting originals.
- `0006_observation_validation.sql` and ADR-0006 make trust governed, versioned, effective-dated, and conservative when evidence is insufficient.
- `0009_quantity_derivation.sql` and the quantity-derivation module provide versioned synthetic direct-discharge, rating-curve, integration, and counter boundaries. Stage-derived values remain estimated and never claim a universal or official curve.

## D. Telemetry — verified

- `packages/domain/src/telemetry/simulator.ts` deterministically covers normal, over, under, stale, offline, spike, frozen, device-fault, counter-reset, and rollover behavior across all 83 devices/249 sensors; offline emits status absence rather than numeric zero.
- `apps/api/src/modules/telemetry/adapter.ts` is a vendor-neutral ingestion port with bounded queue, acknowledgement, replay, idempotency, explicit overflow, and preserved source ordering/timestamps. Real MQTT/industrial protocols remain replaceable future adapters under B-003.
- `0007_device_health_live.sql` and the device-health/live services persist connection, fault, last-received, last-observed, power/signal, data condition, and a bounded resumable journal/SSE feed. Communication and numerical trust remain independent.
- Telemetry and device-health unit/database tests prove all scenarios, replay/conflict behavior, transaction coupling, relocation-safe scope, delayed facts, degraded dependency behavior, and production-disabled simulation.

## E. Allocation and water accounting — verified

- `0008_allocation_plans.sql` stores sequential effective-dated plan versions, entries, requester, distinct approver, reason, reference, approval/supersession time, and atomic audit. Lifecycle/concurrency tests reject direct or overlapping governance bypasses.
- `0009`–`0010` and the derivation/deviation modules compare exact planned and actual `m3` over the same microsecond interval, preserving signed, absolute, and rational percentage deviation.
- Tolerance policies are immutable, versioned, effective-dated, and scoped to network sections rather than globally hard-coded.
- `0011_water_balance_travel_time.sql` and water-balance tests preserve incoming/outgoing measured volumes, additions, removals, storage change, fixed travel-time alignment, and exact unexplained residual as separate `m3` terms. Residuals are alarm-ineligible and never labeled loss/theft without B-005 authority inputs.

## F. Alarms and incidents — verified

- ADR-0008, `0012_alarm_rule_engine.sql`, and the alarm-rule domain separate water condition from severity and evaluate governed quality, uncertainty, tolerance, rate, persistence, hysteresis, source gaps, and bitemporal evidence. Tests prove a lone/invalid spike cannot create a false critical event and stale terminal evidence cannot activate, persist, or clear a signal.
- `0013_alarm_catalog.sql` and typed contracts contain the required over/under allocation, unexplained balance, sudden flow, high stage, dry canal, frozen/impossible sensor, communication, power, calibration, and network-consistency families.
- `0014_incident_workflow.sql` supports materialization, acknowledge, investigate, assignment, comment, governed automatic clear, resolve, close, immutable timeline/audit, escalation snapshot, deadlines, and response metrics.
- Alarm, incident, center, and P7 scenario tests prove workflow separation, concurrency, immutable evidence, premature-resolution refusal, and synthetic/nonofficial policy boundaries. B-006 remains the source of official threshold/severity/escalation policy.

## G. Command Dashboard — verified

- `0015_dashboard_synthetic_scenario.sql`, dashboard contracts/services, and `apps/web/src/dashboard.tsx` expose regional inflow `m3/s`, delivered/planned volume `m3`, exact compliance, balance residual, critical alarms, system-confidence unconfigured state, station data coverage, and explicit device communicating/offline/unknown counts with a denominator.
- Today/week/month/season/year windows use exact UTC boundaries with `Asia/Tashkent` presentation and prior equal-duration comparisons.
- Important deviations show exact signed/absolute magnitude, exact server-derived duration, data state/quality, and stable map/live drill targets.
- Contract/domain/API/database/web/browser tests prove denominator reconciliation, no-data precedence, exact rational arithmetic, period integrity, visible synthetic provenance, keyboard/focus behavior, and unit separation.

## H. Live Operations — verified

- `0016_live_operations_read_model.sql`, live-operation contracts/services, and `apps/web/src/live-operations.tsx` expose station/device/waterway/section, stage/discharge/volume, plan/variance placeholders, quality/water/device status, last receipt/source age, power/signal, calibration, and alarm state.
- Server-owned hierarchy/status/quality filters are bounded and territory-authorized. Row selection uses a stable hash and persistent inspector without losing table/filter context.
- The inspector exposes recent trend, raw versus governed revisions, device health/metadata, calibration/rating references, alarm placeholders, and bounded typed maintenance history or an explicit unconfigured/empty state.
- Unit/database/web/browser tests prove source/revision integrity, scope-safe live invalidation, explicit empty/degraded states, focus return, and responsive table containment.

## I. GIS and network map — verified

- Map/network contracts, services, and `apps/web/src/map-network.tsx` use basin aggregation at regional scale, progressive station/waterway/junction/section detail, coordinated geography and canonical directed topology, and a keyboard-reachable semantic feature list.
- Selection presents current discharge, explicitly unconfigured target/plan/variance/duration/confidence when policy is absent, last observation, and responsible territory without inventing compliance.
- Bounded upstream/downstream traversal follows the seeded directed graph; a 24-frame synthetic paused playback retains explicit gaps.
- Labels/icons/values accompany color for OVER, ON PLAN, UNDER, NO DATA, and DEVICE FAULT/UNRELIABLE. Contract/domain/database/web/browser tests cover scope, topology, traces, playback, focus, localization, and 390 px containment.

## J. Analytics — verified

- `0017_analytics_synthetic_scenario.sql`, analytics contracts/domain/services, and the web workspace compose exact planned/actual/deviation analysis for server-owned region/basin/waterway/section facets and periods.
- Delivery status groups/matrix reconcile counts and exact `m3` totals or fail conservatively when a bounded population is incomplete.
- Water balance preserves measured deliveries, expected additions/removals/storage/travel terms, and residual; quality and device availability have separate disclosed denominators.
- Analytics database/contract/domain/API/web/browser tests prove immutable cutoffs, topology scope, exact arithmetic, microsecond drift deferral, unassessable precedence, and no forecast/AI/control truth claim.

## K. Reports and audit — verified

- `0018_report_snapshots.sql` and report modules generate daily situation, allocation compliance, water balance, device availability, per-incident, and executive summary snapshots from governed sources only.
- Immutable canonical snapshots retain version, period/cutoff, source identities/revisions, methodology/version, quality, generator, truthful approval state, generation time, synthetic provenance, and fingerprint. Later corrections do not change frozen bytes.
- Authenticated CSV is deterministic RFC 4180/Excel-compatible with formula-prefix protection; semantic print-ready A4 HTML supports browser PDF output. Export actions and generation are audited.
- `0019_audit_explorer.sql` and audit modules provide role/territory-scoped searchable compact history plus bounded exact old/new detail, strict filters, and stable keyset paging. Report/audit database, web, rendered-output, and browser evidence is recorded under P6-002/P6-003.

## L. Identity, authorization, and security — verified

- Identity contracts and `0002_identity_territory.sql` provide system/national administration plus regional director, basin dispatcher, district operator, hydrologist, maintenance engineer, and auditor roles with effective-dated role-and-territory grants.
- ADR-0010 requires authentication before protected parsing/lookups; the production truth table hard-disables local header identity and retains an injectable MFA-ready OIDC/SAML provider boundary.
- Policy, repository, and real HTTP PostgreSQL matrices prove same-scope permission and cross-district/cross-organization nonenumeration with zero denied mutation/audit/journal side effects.
- Privileged mutations and append-only audit share transactions. Request IDs are bounded correlation evidence, not authority. Body/error/CORS/cache/frame/referrer protections are tested.
- Tracked-file secret scans, high-severity dependency audits, no-control route regression, and QA/security review have no unresolved critical/high finding. The web/API contains no gate, pump, valve, PLC, or RTU actuation path.

## M. Accessibility and localization — verified

- Status always combines readable text, icon, and value with color; shell semantics provide skip navigation, landmarks, native controls/labels, focus-visible treatment, and responsive/local table overflow.
- Primary dashboard, live, map, alarm/incident, analytics, report, and audit workflows preserve keyboard access and deterministic focus entry/return.
- `packages/i18n/src/index.ts` supplies typed Uzbek, Russian, and English shell/status/workflow vocabulary; completeness tests reject missing strings and the browser smoke switches all three locales.
- Web tests and Chromium cover document language, accessible names, explicit degraded states, focus behavior, clean console, and 390 px containment. This is WCAG 2.2 AA-oriented design evidence, not an external conformance certification.

## N. Observability and resilience — verified

- Fastify structured JSON logs and every response carry a bounded request ID; safe dependency/unhandled errors remain correlated without exposing implementation detail.
- `/health/live`, `/health/ready`, and `/metrics` separate process liveness, database availability, telemetry receipt/source lag, explicit connection/fault/data states, ingestion/validation outcomes, deferred alarm rules, and bounded route-template errors.
- Missing health is `unconfigured`, no-data remains distinct, freshness is omitted without evidence, and a failed database scrape returns 503 rather than fabricated normal/zero values.
- The rollback-only load test accepts 249 canonical readings across 83 devices, replays idempotently, reports bounded local timing without a production SLO, and proves exact post-rollback source counts.
- ADR-0011 and `docs/OPERATIONS.md` document process-counter retention, guarded readiness recovery, migration-complete custom-format backup/restore, encryption/retention caution, and honest local-versus-production RPO/RTO/HA/DR boundaries. Migration 0020 makes the PostGIS validator restore-session safe.

## O. External rollout dependencies — open by design

`docs/BLOCKERS.md` B-001–B-008 owns official calibration/rating curves, GIS/assets, device protocols/certificates, legal allocations/tolerances, hydrological accounting/uncertainty, alarm/escalation policy, accredited identity/security/deployment, and production monitoring/backup/HA/DR. Until authorized humans supply and approve those inputs, every operational result remains synthetic/nonofficial and the platform remains monitoring/decision support only. Remote or autonomous physical control is outside the MVP and absent from the software.

## Final verification commands

```powershell
pnpm install --frozen-lockfile
pnpm verify
pnpm db:migrate
pnpm db:migrate
pnpm db:seed
pnpm db:seed
pnpm --filter @isuv/api test:db
pnpm test:e2e
pnpm audit --prod --audit-level high
docker compose --env-file .env config --quiet
pwsh -File scripts/backup-restore-smoke.ps1 -Cleanup
pwsh -File scripts/p7-readiness-recovery-smoke.ps1 -AllowServiceInterruption
```

Exact final counts, clean-checkout startup evidence, review disposition, and commit are recorded in `TASKS.md` P7-004 and `docs/EXECUTION_LEDGER.md` so this matrix stays readable and the ledger remains the chronological source of verification results.
