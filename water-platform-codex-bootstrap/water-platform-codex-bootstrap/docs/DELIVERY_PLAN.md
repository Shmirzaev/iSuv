# Delivery Plan

The autonomous build should use vertical slices. “Complete” means tested, integrated, documented, and demonstrable with synthetic data.

## Phase 0 — Repository foundation

- Inspect existing code and preserve useful work.
- Establish ADRs and module boundaries.
- Make local startup repeatable.
- Add migrations, seed strategy, typed contracts, test commands, and CI/local verification.

## Phase 1 — Master data and identity

- Organizations, territories, roles, users.
- Region/basin/waterway/topology/station/device/sensor registry.
- Territory-aware authorization and audit skeleton.
- Synthetic 83-hotspot dataset.

## Phase 2 — Telemetry and data quality

- Simulator and ingestion adapter.
- Observation storage/history.
- Quality, staleness, duplicate/out-of-order handling, revisions.
- Device health and live update path.

## Phase 3 — Allocation and accounting

- Versioned approved plans and tolerances.
- Discharge/volume integration boundaries.
- Parent-child balance and residual.
- Time alignment/travel-time model.
- Deterministic tests.

## Phase 4 — Alarms and incidents

- Rule engine with quality, persistence, hysteresis, and severity.
- Alarm lifecycle, assignment, acknowledgement, resolution, incident timeline.
- Escalation metadata and reporting hooks.

## Phase 5 — Operator application

- Command dashboard.
- Live operations table and inspector.
- GIS plus hydrological network view.
- Global alarm/incident center.
- Localization and accessibility baseline.

## Phase 6 — Analytics and reporting

- Delivery, equity, balance, deviation, quality, and availability analysis.
- Versioned/snapshotted reports and exports.
- Audit explorer.

## Phase 7 — Hardening

- Authorization matrix tests.
- Security review and dependency checks.
- Browser/end-to-end flows.
- Performance and telemetry-volume smoke tests.
- Observability, backup/restore, failure-mode documentation.
- Final acceptance evidence.

## Later phases requiring external inputs

- Real sensors and protocols.
- Official GIS/topology and allocations.
- Hydrological calibration/rating curves.
- Weather/satellite/reservoir integrations.
- Predictive models/digital twin.
- Mobile field application.
- Government infrastructure and accreditation.
- Carefully governed remote control after a separate safety case.
