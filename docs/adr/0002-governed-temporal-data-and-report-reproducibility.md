# ADR-0002: Governed Temporal Data and Report Reproducibility

- Status: Accepted
- Date: 2026-08-23
- Owners: Primary agent

## Context

Government operators must be able to explain corrections, determine which allocation/rule/rating version applied at a past instant, and retrieve a historical report without silently changing it after later data revisions. Observation time and ingestion time are different facts. Missing or unreliable coverage cannot be treated as zero or normal.

## Decision

- Store observations as append-oriented immutable source events with separate UTC observation and ingestion timestamps, stable source/idempotency identity, device/sensor identity, explicit quantity and unit, quality/reason, state, provenance, uncertainty, and synthetic classification.
- Store corrections as new revisions linked to the original lineage. Never overwrite an accepted historical value in place. A current-revision projection may be derived for operational reads.
- Model allocation plans, tolerances/rules, and rating curves as approved, versioned, effective-dated records. Historical evaluation resolves the version valid for the evaluated interval.
- Persist report snapshots with reporting period, source cutoff, selected revision/snapshot identifier or immutable payload and checksum, methodology identifier/version, quality/coverage state, generator, approval status, and generation time. Retrieval and regeneration use the saved snapshot rather than live re-query semantics.
- Use PostgreSQL `timestamptz` for persisted instants and present explicit local time only at UI/report boundaries.

## Alternatives considered

- Mutable observation rows with an audit log: rejected because an audit side table is easier to desynchronize and makes report reproduction fragile.
- Rebuild historical reports from the latest corrected values: rejected because it silently changes the official historical artifact.
- Generic numeric readings with string units: rejected because it allows stage, discharge, and volume to be conflated.

## Consequences

- Storage grows by revision rather than update, and queries need an explicit current/as-of view.
- Corrections and late data can trigger bounded recomputation while preserving prior evidence.
- Quantity coverage and confidence travel with derived values; incomplete intervals cannot produce a confident allocation status.
- Retention and archival policy remains an external governance decision, but export must preserve lineage.

## Verification

- Duplicate ingestion is idempotent and correction tests retain the original revision.
- As-of plan/rule/rating tests select the correct approved effective version.
- A saved report snapshot remains byte/logically stable after a later correction.
- Tests reject cross-quantity unit misuse and expose incomplete coverage as unknown/unreliable.
