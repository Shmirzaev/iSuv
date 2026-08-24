# ADR-0010: Authentication-first API boundary

- Status: Accepted
- Date: 2026-08-24

## Context

Protected handlers previously varied in whether they parsed request data before resolving a current identity session. Most did not access protected data first, but malformed anonymous requests could still distinguish validation failures from authentication failures. The local header identity adapter also needed an unconditional production safety boundary, and application-wide response/error limits were implicit.

## Decision

- Every protected API handler resolves the identity and current session before parsing identifiers, query parameters, or bodies and before any territory, repository, or service lookup.
- Anonymous malformed, present, and absent targets therefore fail with the same typed `401`; authenticated malformed input remains a typed `400`.
- The `x-isuv-user-id` adapter is explicit local/test tooling and is unconditionally disabled when `NODE_ENV=production`, even if its enable flag is set. Production identity remains an injectable OIDC/SAML/MFA-ready adapter responsibility.
- Request IDs are bounded safe correlation context, not identity, authorization, or independent proof of an action. Privileged audit continues to bind the resolved actor and database-owned mutation in one transaction.
- The API owns a 256 KiB request-body limit, safe generic error responses, deny-by-default CORS, no-store caching, and baseline browser response headers. TLS, rate limiting/WAF, and accreditation remain deployment responsibilities.

## Consequences

- Authentication behavior is consistent across all protected modules and does not disclose input shape to anonymous callers.
- Route helpers pass one resolved actor through the request path, avoiding repeated session evaluation and time drift.
- Local demos remain usable without making header identity a production credential.
- High-confidence tracked-file secret checks and high-severity dependency audit run in verification/CI, but do not replace organization-wide secret scanning, immutable supply-chain pinning, ingress controls, or security accreditation.

## Verification

- Adversarial route tests cover every formerly auth-after-validation module and assert zero protected lookup/authorization calls.
- The real PostgreSQL HTTP matrix proves same-territory permission, cross-district nonenumeration, and zero denied mutation/audit/journal side effects for allocation, incident, and device-health paths.
- Identity truth-table, payload/error/header/CORS/request-ID, no-control, dependency, full unit/build, serial DB, and browser gates pass.
