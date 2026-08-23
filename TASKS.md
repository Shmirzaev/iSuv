# Autonomous MVP Task Graph

Status: `[ ]` todo, `[~]` in progress, `[x]` verified, `[!]` blocked.

The primary agent may split tasks further. It must preserve IDs/dependencies, add measurable exit evidence, and keep only one active owner per overlapping file area.

## Phase 0 — Foundation

- [x] **P0-001 — Repository audit and baseline**
  Depends: none.
  Exit: existing stack/features/tests are documented; Git baseline and risks recorded; no destructive rewrite started.
  Evidence: `docs/BASELINE.md`; baseline commit `409668f`; read-only architecture and hydrology audits; Node/pnpm/Docker toolchain probes.

- [x] **P0-002 — Architecture ADRs and module boundaries**
  Depends: P0-001.
  Exit: stack/deployment/data/API decisions are recorded with trade-offs and preserve useful existing code.
  Evidence: accepted ADR-0001 through ADR-0003; ESLint import-boundary rules enforce shared-package and application dependency direction.

- [x] **P0-003 — Repeatable local environment**
  Depends: P0-002.
  Exit: documented startup, `.env.example`, persistent services, health checks, migrations, and seed command work from a clean checkout.
  Evidence: Compose config passes; PostGIS 17/PostGIS 3.5 reports healthy; migration twice and seed twice succeed; API live/readiness/metrics return 200 against the database; Vite shell smoke returns 200; startup and local backup/restore commands are documented.

- [x] **P0-004 — Verification pipeline**
  Depends: P0-003.
  Exit: format/lint/type/test/build commands and CI or one local verification script pass.
  Evidence: clean frozen dependency install and `pnpm verify` pass; CI runs the same verification plus repeated PostGIS migration/seed; production API/web builds pass; dependency audit reports no known vulnerabilities.

## Phase 1 — Identity, topology, and master data

- [x] **P1-001 — Organizations, territories, roles, and authorization skeleton**
  Depends: P0-003.
  Exit: core roles and territory scope are modeled; cross-territory denial tests exist.
  Evidence: migration-backed organizations, hierarchical territories, eight core roles, effective-dated grants, and fail-closed local identity adapter; unit/API tests cover same/ancestor/cross-territory and read-only auditor behavior; real PostGIS tests cover organization isolation, inactive/unknown targets, UTC boundaries, non-overlapping re-grants, and concurrency-safe cycle prevention; full verification and security/reviewer gates pass.

- [x] **P1-002 — Water-network and asset schema**
  Depends: P0-002, P0-003.
  Exit: region/basin/waterway/junction/section/control/station/device/sensor entities, migrations, validation, and APIs exist.
  Evidence: accepted ADR-0004; typed PostGIS master-data migration and territory-authorized read APIs; single authoritative section DAG supports branches/merges and rejects direct/concurrent cycles; cross-boundary identifiers are redacted; effective-dated device installations preserve provenance; DB/contracts enforce entity geometry and WGS84 bounds plus stage→m, discharge→m³/s, accumulated volume→m³; 16 API/unit and 7 real-DB tests pass; QA and reviewer approve.

- [x] **P1-003 — Synthetic 83-hotspot topology seed**
  Depends: P1-002.
  Exit: 83 labeled synthetic top-level nodes with realistic branches and station/device coverage load reproducibly; topology validation passes.
  Evidence: atomic deterministic seed creates exactly 83 labeled entry roots across five compact synthetic basin DAGs with pairwise merge collectors and five outlets; 493 junctions, 571 sections, 83 monitoring-only control structures/stations/devices/installations, and 249 canonical sensors load reproducibly; PostGIS tests prove containment, endpoint alignment, root-to-outlet reachability, cross-territory continuity, classification, and persistent-state reconciliation; seed x2, 17 unit/API tests, and 8 DB tests pass; hydrology, QA, and reviewer gates approve.

- [x] **P1-004 — Audit foundation**
  Depends: P1-001.
  Exit: privileged changes create searchable old/new/reason/actor/time audit records.
  Evidence: accepted ADR-0005; typed v1 role-grant create/revoke/cancel APIs write the grant change and append-only audit event atomically with actor and target organizations, territory, old/new state, reason, request ID, provenance, classification, and UTC time; conservative strictly-higher role delegation prevents self/peer escalation; explicit DB-authoritative scheduled cancellation preserves history and cannot cross the effective boundary; scoped audit reads use bounded filters and composite keyset cursors; 22 API/unit and 12 real-DB tests pass; QA/security and final reviewer approve.

## Phase 2 — Telemetry and data quality

- [x] **P2-001 — Observation schema and revision model**
  Depends: P1-002.  
  Exit: explicit quantity/unit, timestamps, quality, provenance, raw/validated/corrected states, and immutable revision history exist.
  Required evidence: database/contracts reject cross-quantity units and preserve decimal values; server receipt time is distinct from device observation time; observation-time installation resolution snapshots station/device/sensor provenance; concurrent source duplicates are idempotent; revisions are append-only and linear; correction leaves the source revision intact and atomically writes audit evidence; current/as-of/history reads are territory-authorized; no-data and unreliable observations cannot be consumed as normal; accumulated-volume readings remain totalizer counters rather than derived interval delivery.
  Evidence: migration-backed immutable lineages and linear revisions preserve exact decimal values and microsecond UTC observation/receipt instants; contracts and DB enforce stage→m, discharge→m³/s, accumulated_volume→m³, raw-quality, method, uncertainty, classification, and totalizer invariants; ingestion resolves and transactionally rechecks the installation/territory effective at observation time; source identity is vendor-neutral and concurrently idempotent; correction/rejection/estimation require `telemetry:correct`, preserve source evidence, and atomically append audit; current/as-of/history use exact keyset boundaries; 27 API/unit and 15 real-DB tests pass; hydrology, QA/security, and reviewer approve.

- [x] **P2-002 — Telemetry adapter and simulator**
  Depends: P2-001, P1-003.  
  Exit: normal/over/under/offline/stale/spike/frozen/fault scenarios stream through an adapter into storage.
  Required evidence: deterministic scenario generation preserves quantity/unit and accumulated-counter semantics; all 83 synthetic devices/sensors are covered; offline is absence rather than zero; stale/frozen/spike/fault facts remain raw and visibly unreliable pending P2-003 validation; adapter source IDs make replay idempotent; a bounded edge-buffer/replay boundary is represented; no simulator path is enabled as production or exposes physical control.
  Evidence: versioned deterministic synthetic envelopes cover 83 devices and all 249 canonical stage/discharge/accumulated-volume sensors with microsecond-preserving UTC source identities; independent normal/high/low/frozen/spike profiles, explicit totalizer reset/rollover, raw unknown/suspect/invalid trust, and status-only offline gaps retain the P2-003/P2-004 boundaries; a vendor-neutral adapter and bounded append/ack/replay queue preserve timestamps and IDs while reporting overflow/failure; authenticated preview/run routes authorize every derived territory, bind the expected installation territory on each write, are opt-in outside production, and expose no control path; 36 API/unit tests, 5 domain tests, 2 contract tests, and 17 real-DB tests pass with all-249 ingestion/replay/conflict evidence; hydrology, QA/security, and reviewer approve.

- [x] **P2-003 — Idempotency, late/out-of-order, stale, and validation rules**
  Depends: P2-002.  
  Exit: deterministic tests prove duplicate, late, impossible, missing, frozen, and corrected data behavior.
  Required evidence: a versioned, effective-dated validation profile is selected by observation time; absent or insufficient policy defers validation rather than declaring data valid; automatic validation appends one audited linear revision under retry/concurrency and preserves source evidence; late/stale/frozen/counter-transition handling is deterministic and never invents missing readings, interval volume, rating-curve discharge, allocation status, balance, or alarms; coverage distinguishes unconfigured/no-data/incomplete/complete; only valid governed revisions become usable and synthetic validation remains visibly non-authoritative.
  Evidence: immutable organization/territory/sensor/classification-scoped profile versions require explicit rules, distinct-author approval, non-overlapping effective intervals, and observation-time selection; exact microsecond/rational evaluation distinguishes stale, late, out-of-order, frozen, bounded plausibility/rate, bootstrap, and accumulated-counter transitions; absent profiles, temporal-only passes, insufficient governed context, and non-raw current revisions defer without appending; automatic validation preserves source fields, uses governed-valid history across relocation, appends one lineage-locked revision/execution/sanitized audit under retry/correction concurrency, and never creates coverage, interval volume, rating conversion, allocation, balance, alarm, or device-health claims; cross-organization governance is limited to active effective system authority while national/ordinary actors remain organization-local; clean migration/seed repeat, 38 API tests, 9 domain tests, 3 contract tests, and 21 real-DB tests pass; hydrology, QA/security, and reviewer approve.

- [~] **P2-004 — Device health and live delivery API**
  Depends: P2-002.  
  Exit: last seen, data age, power/signal placeholders, quality, and recent history are available to the UI with live updates.
  Required evidence: last-seen receipt time and last-observed source time remain distinct; offline/no-data/stale/unreliable/device-fault states are explicit and never inferred as zero or normal; power/signal fields distinguish unknown placeholders from measured values; territory-authorized current/history APIs and resumable bounded SSE update clients without a page reload; synthetic status events remain labeled and cannot create physical-control paths; reconnect, slow-consumer, authorization, and degraded-database tests pass.

## Phase 3 — Allocation and accounting

- [ ] **P3-001 — Versioned allocation plans and approvals**  
  Depends: P1-001, P1-002, P1-004.  
  Exit: effective-dated plan versions, requester/approver/reason/reference, and historical lookup are implemented and tested.

- [ ] **P3-002 — Quantity conversion and volume integration boundary**  
  Depends: P2-001.  
  Exit: stage/discharge/volume remain distinct; synthetic rating-curve adapter and discharge-to-volume integration are tested.

- [ ] **P3-003 — Planned-vs-actual and configurable tolerances**  
  Depends: P3-001, P3-002.  
  Exit: interval-aligned absolute/percentage variance and scoped tolerances are tested.

- [ ] **P3-004 — Parent-child water balance and travel-time model**  
  Depends: P1-003, P3-002.  
  Exit: expected terms and unexplained residual are calculated; time alignment is configurable/explicit and tested.

## Phase 4 — Alarms and incidents

- [ ] **P4-001 — Rule engine**  
  Depends: P2-003, P3-003, P3-004.  
  Exit: rules use validity, tolerance, persistence, rate of change, and hysteresis; single bad spikes do not create critical alerts.

- [ ] **P4-002 — Alarm severity and event catalog**  
  Depends: P4-001.  
  Exit: required water and device event classes, separate water condition/severity, and evidence fields exist.

- [ ] **P4-003 — Incident lifecycle and escalation metadata**  
  Depends: P4-002, P1-001, P1-004.  
  Exit: acknowledge/assign/comment/resolve/close timeline, ownership, metrics, and audit are implemented.

## Phase 5 — Operator application

- [ ] **P5-001 — Application shell, navigation, localization, accessibility baseline**  
  Depends: P0-003, P1-001.  
  Exit: role-aware shell, global alarm access, Uzbek/Russian/English string system, keyboard/focus/status patterns exist.

- [ ] **P5-002 — Command dashboard**  
  Depends: P2-004, P3-003, P3-004, P4-002, P5-001.  
  Exit: required KPIs, ranked deviations, plan/actual/previous comparison, confidence, period controls, and drill-down work.

- [ ] **P5-003 — Live operations table and inspector**  
  Depends: P2-004, P3-003, P5-001.  
  Exit: required columns, filters, live/stale behavior, and detail inspector work with seeded data.

- [ ] **P5-004 — GIS plus hydrological network view**  
  Depends: P1-003, P2-004, P3-004, P5-001.  
  Exit: aggregation/progressive detail, topology view, drill panel, upstream/downstream tracing, accessible states, and temporal playback abstraction work.

- [ ] **P5-005 — Alarm and incident center**  
  Depends: P4-003, P5-001.  
  Exit: queue, filters, acknowledgement, assignment, comments, timeline, and closure work under territory authorization.

## Phase 6 — Analytics, reports, and audit

- [ ] **P6-001 — Delivery, deviation, balance, quality, and availability analytics**  
  Depends: P3-004, P5-001.  
  Exit: required analyses and period/scope filters work and do not overstate data confidence.

- [ ] **P6-002 — Versioned report snapshots and exports**  
  Depends: P3-001, P4-003, P6-001.  
  Exit: required MVP reports include metadata, are reproducible, and support print/PDF plus tabular export.

- [ ] **P6-003 — Audit explorer**  
  Depends: P1-004, P5-001.  
  Exit: authorized users can search and inspect important changes without mutating them.

## Phase 7 — Hardening and final acceptance

- [ ] **P7-001 — End-to-end operational scenarios**  
  Depends: all P1–P6 MVP tasks.  
  Exit: automated/browser scenarios cover normal delivery, over/under allocation, device outage, invalid spike, unexplained balance, acknowledgement, resolution, and report generation.

- [ ] **P7-002 — Security and authorization review**  
  Depends: P7-001.  
  Exit: no critical finding; territory/role tests pass; no physical control path; secrets and dependency checks pass.

- [ ] **P7-003 — Performance, observability, backup/restore, and degraded-mode smoke tests**  
  Depends: P7-001.  
  Exit: agreed synthetic load works; telemetry lag/errors are observable; backup/restore and outage behavior are demonstrated/documented.

- [ ] **P7-004 — Acceptance audit and handover**  
  Depends: P7-002, P7-003.  
  Exit: every `MVP REQUIRED` criterion has linked evidence; README/operator/dev docs are current; external rollout blockers are explicit; final demo starts from a clean checkout.
