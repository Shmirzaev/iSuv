# ADR-0005: Atomic Privileged Audit and Conservative Role Delegation

- Status: Accepted
- Date: 2026-08-23
- Owners: Primary agent

## Context

Privileged identity changes must be explainable, searchable, and resistant to partial failure. A role grant that commits without its audit evidence, mutable audit history, or a scheduled elevation that cannot be withdrawn would undermine least privilege and incident reconstruction. Official government IAM delegation and records-retention policy are not yet available, so the MVP needs a safe, reversible technical default without claiming final policy authority.

## Decision

Store privileged audit events in an append-only PostgreSQL table with typed action/resource identifiers, actor and target organization identity, responsible territory, old and new state, reason, request/correlation ID, UTC occurrence time, classification, and provenance. The database rejects update and delete operations on audit events. Mutation and audit insertion share one database transaction; either both commit or neither does.

Authorize role-grant creation, revocation, and cancellation through role plus territory scope. An actor may administer only a strictly lower-ranked role that the actor's effective grant covers. Users cannot administer themselves, auditors remain read-only, national grants remain organization-bound, and system scope is the only cross-organization authority. Unknown and out-of-scope resources are intentionally indistinguishable where disclosure would enable enumeration.

Represent scheduled-grant cancellation explicitly rather than deleting or fabricating an empty validity interval. A cancelled grant retains its original effective window and records `cancelled_at`; PostgreSQL enforces `created_at <= cancelled_at < effective_from`. Cancellation uses database transaction time and a guarded update, is excluded from all effective-grant queries, releases the cancelled range for a corrected schedule, and emits its own audit action. Active grants use effective-dated revocation instead.

Expose bounded, territory-authorized v1 audit reads with action/resource/actor/time filters and a composite occurrence-time/event-ID keyset cursor so equal-timestamp events are not skipped.

## Alternatives considered

- Write audit after committing the mutation: rejected because failures can leave an unaudited privilege change.
- Allow audit updates/deletes: rejected because administrative history would not be trustworthy.
- Permit same-rank or self administration: rejected as an unsafe default before authoritative delegation policy exists.
- Delete or shorten a not-yet-effective grant into an invalid interval: rejected because it destroys or misstates history.
- Use application time alone for cancellation boundaries: rejected because application/database clock drift or transaction latency can cross the activation boundary.

## Consequences

- System-administrator and peer-role provisioning requires a separately controlled higher authority; this is a conservative MVP boundary, not final government IAM policy.
- Cancellation and revocation remain distinct, searchable historical events.
- The local development database owner can technically disable triggers; production deployment must use separated migration and runtime roles with runtime ownership unable to weaken audit protections.
- Future audit resource types must add typed actions and event-specific state validation rather than accepting arbitrary writers.

## Verification

- Database tests prove grant mutation and audit insertion are atomic, audit rows reject update/delete, and actor/target organization constraints hold.
- Authorization tests cover same, ancestor, cross-territory, cross-organization, inactive, unknown, self, peer/higher-role, and read-only-auditor cases.
- Cancellation tests use database-derived time, reject application/database clock divergence and direct invalid DML, preserve the original window, exclude live authority, permit corrected replacement, and prevent repeated cancellation/revocation.
- Audit query tests cover authorization, bounded filters, and equal-timestamp composite-cursor pagination.
