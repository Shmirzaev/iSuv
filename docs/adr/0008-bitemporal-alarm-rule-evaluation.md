# ADR-0008: Bitemporal Alarm-Rule Evaluation and Condition-Signal Boundary

- Status: Accepted
- Date: 2026-08-24
- Owners: Primary agent

## Context

The MVP must apply data validity, tolerance, persistence, rate-of-change, and hysteresis before creating operational alerts. A single invalid spike must not create a critical alert, missing or unreliable evidence must never appear normal, and later observations or corrections must not silently rewrite what operators knew at an earlier cutoff. Final alarm severity, catalog entries, acknowledgements, incidents, escalation, and physical actions are separate responsibilities.

Process-local timers or mutable current-only state cannot reproduce event-time behavior after restart, late arrival, or correction. Accepting caller-supplied measurement values would also bypass the governed observation, allocation, and accounting boundaries already established by P2 and P3.

## Decision

Introduce a governed condition-signal engine whose immutable rule identities have sequential, effective-dated, distinct-author-approved versions. Rule evaluation accepts only a configured rule subject plus exact `effectiveAt` and `knownAt`; the service resolves governed evidence internally. Rule definitions are strict typed unions rather than permissive expressions. P4-001 initially supports direct observation threshold/rate rules and allocation-deviation rules. It consumes P3-003 computed whole-entry deviation and tolerance outcomes rather than duplicating allocation math. P3-004 balance results remain ineligible while their contract explicitly states `alarmEligible: false`; a later governed residual/uncertainty attestation is required before balance can become an alarm source.

Evaluate exact rational quantities in event-time order at microsecond precision. High rules enter only above the enter threshold and clear at or below a lower clear threshold; low rules are symmetric. Threshold equality is not a breach. Activation and clearing have independent positive persistence requirements, require at least two contiguous qualifying facts, and cannot bridge a configured maximum gap. Optional rate gates use exact same-quantity change divided by exact elapsed seconds; stage, discharge, and volume remain distinct, and accumulated volume is never treated as instantaneous flow.

Append an immutable, idempotent evaluation run and evidence snapshot for each evaluated cutoff. Runs record both effective/event time and knowledge cutoff. A later fact or correction creates a later-cutoff run rather than mutating earlier operational evidence. A small current projection may support operational reads, but immutable runs are authoritative and rebuildable. Missing, unconfigured, raw, suspect, invalid, estimated, wrong-unit, unknown-uncertainty, or otherwise unassessable evidence produces a typed deferred result. It breaks pending continuity and cannot activate or falsely clear a previously active condition.

P4-001 outputs condition states only: inactive, pending activation, active, pending clear, or deferred. P4-002 owns event families, separate water/device status, severity, operator-facing alarm records, and catalog evidence. P4-003 owns acknowledgement, investigation, assignment, comments, response metrics, escalation, resolution, incident closure, and their audit. No layer exposes direct gate, pump, valve, PLC, or RTU control.

## Alternatives considered

- Mutable current alarm state only was rejected because late and corrected evidence would silently rewrite history and could not be reproduced at an earlier `knownAt`.
- Process-local timers were rejected because restart, deployment, and replay would change persistence outcomes.
- A generic caller-authored expression language was rejected because it weakens unit safety, source governance, reviewability, and database enforcement.
- Caller-supplied measurement values on the evaluation API were rejected because they bypass trusted revisions and configured subjects.
- Creating alarm/severity/incident records in the rule engine was rejected because it couples numerical condition detection to catalog and workflow policy.
- Enabling balance residual alarms immediately was rejected because official residual tolerance and uncertainty policy is unavailable and P3-004 is explicitly alarm-ineligible.

## Consequences

- Operational condition evidence is reproducible by effective time and knowledge cutoff, survives restart, and retains late/correction history.
- Invalid and missing data remain visible non-normal outcomes; an active condition cannot disappear merely because evidence becomes unreliable.
- Synthetic rules and results remain nonofficial. B-004 and B-005 still block authoritative thresholds, escalation, residual, and uncertainty policy.
- Adding a new rule family requires a typed adapter that resolves governed source evidence and preserves exact quantity, unit, quality, provenance, revisions, intervals, and classification.

## Verification

Domain tests must cover exact threshold/rate boundaries, upper/lower hysteresis, independent activation/clear persistence, gap discontinuity, invalid and single-spike suppression, and quantity separation. Database tests must cover rule governance, authority, atomic audit, append-only/idempotent evaluation evidence, current projection rebuildability, and later-cutoff history. API tests must prove auth-first non-enumeration, strict cutoffs, typed dependency failure, configured-source-only evaluation, and absence of physical-control paths.
