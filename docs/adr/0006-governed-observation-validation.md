# ADR-0006: Governed observation validation

- Status: Accepted
- Date: 2026-08-24

## Context

Raw device evidence cannot become accounting truth from adapter claims or a universal default. Official station bounds, cadence, calibration, rating curves, and counter policies are not available, while synthetic workflows still need deterministic validation behavior and auditable history.

## Decision

Store append-only validation profiles scoped to organization, territory, sensor, quantity, and classification. Profile versions begin as drafts, require a distinct authorized approver, use non-overlapping effective intervals, and are selected by the observation timestamp. Active system-scoped administrators retain the established cross-organization authority; national and ordinary actors remain organization-local.

The pure evaluator uses exact decimal and microsecond arithmetic. It distinguishes stale presentation, late receipt, out-of-order arrival, frozen sequences, configured rate/bounds, and accumulated-counter transitions. A first-sample bootstrap must be explicitly bounded and approved. Context-dependent validity uses only prior governed-valid revisions; raw, suspect, invalid, estimated, or rejected evidence cannot establish trust.

If no approved profile applies, a temporal-only pass occurs, required context is absent, or the current revision is already non-raw, validation defers without appending. Successful evaluation appends one immutable automatic revision, execution identity, and sanitized audit event under the same lineage lock used by human correction.

Interval coverage remains `unconfigured` until an approved cadence/window policy exists. This boundary performs no stage-to-discharge conversion, discharge integration, allocation comparison, balance, travel-time calculation, alarm, incident, or device-health projection.

## Consequences

- Validation is reproducible by profile version, algorithm version, source revision, and evaluation time.
- Only `valid` automatic/expert/corrected revisions are usable; missing or insufficient evidence stays visible and unreliable.
- Synthetic bounds can demonstrate the workflow without being represented as official policy.
- Official deployment still requires authorized station rules, calibration, cadence, device behavior, and hydrological review.
