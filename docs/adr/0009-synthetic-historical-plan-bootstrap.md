# ADR-0009: Synthetic Historical Allocation-Policy Bootstrap for Reproducible Analytics

- Status: Accepted
- Date: 2026-08-24
- Owners: Primary agent

## Context

P6 analytics must demonstrate exact current calendar windows while composing the governed P3 quantity, allocation-deviation, and water-balance services. Allocation-plan approval normally rejects a version whose effective start precedes the approval clock. That is a sound default for ordinary operator/API actions, but it makes a fresh local seed unable to create an already elapsed synthetic calendar interval: future actual observations would misrepresent forecast data as observed evidence, while direct lifecycle SQL would bypass distinct-author approval, audit, and bitemporal history.

The MVP needs repeatable synthetic evidence without weakening the public plan-governance contract or backdating what the system knew. Official allocation policy remains external under B-004.

## Decision

Keep retroactive plan and tolerance-policy approval rejected by default and on every HTTP route. Add explicit service options for the local seed to approve historical effective windows only when the owning plan or tolerance policy is classified `synthetic`. The options are not part of an API contract and are never inferred from request data.

The bootstrap paths use the same service transactions, database clock, distinct requester and approver, overlap checks, immutable versions and entries, legal/reference metadata where applicable, and atomic audit events as ordinary approvals. They do not rewrite `approved_at`, `requested_at`, or any audit timestamp. Consequently, historical reads before the real approval knowledge time still return no approved plan or tolerance; reads at or after the seed scenario cutoff may reproduce the synthetic result.

Analytics inserts its immutable scenario cutoff only after all governed seed actions commit, so `knownAt` never precedes the approvals or observation revisions it exposes. The exception remains synthetic-only and decision-support-only; adding an official retroactive-plan workflow requires legally authoritative policy and a separate decision.

## Alternatives considered

- Directly inserting backdated approved rows was rejected because it bypasses service governance and could forge actor, audit, or knowledge time.
- Moving analytics to a future interval was rejected because future observations would look like operational evidence or forecasts.
- Computing allocation analytics from dashboard fixture rows was rejected because those rows are a presentation fixture, not governed P3 accounting evidence.
- Leaving every delivery result unconfigured was rejected because it would not demonstrate the required planned-versus-actual workflow.
- Allowing all callers to approve retroactive plans was rejected because that changes allocation policy beyond the synthetic MVP and could affect official governance.

## Consequences

- Fresh and repeat seeds can demonstrate governed historical synthetic delivery analytics without falsifying approval knowledge time.
- The ordinary services and all routes retain the no-retroactive-approval rule.
- Tests must prove the option is explicit, synthetic-only, absent from HTTP contracts, audited, distinct-author, immutable, and bitemporally invisible before its real approval time.
- B-004 remains open; no output is official compliance and no physical-control path is introduced.

## Verification

Allocation-plan and tolerance-policy tests must retain default rejection and add seed-option regressions. Analytics database tests must prove governed plan/deviation and balance computation, immutable cutoff ordering, repeatability, pre/post-approval `knownAt` behavior, territory/facet isolation, and synthetic/nonofficial provenance. Full API and browser checks must confirm the options cannot be supplied by a caller.
