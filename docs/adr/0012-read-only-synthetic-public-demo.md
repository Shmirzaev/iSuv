# ADR-0012: Read-only synthetic public demo boundary

- Status: Accepted
- Date: 2026-09-04

## Context

The local demonstration uses an opt-in header identity and a seeded system administrator so a
developer can exercise governed workflows. Exposing that local arrangement publicly would let a
visitor claim predictable seeded identities and reach mutation routes. Production correctly
disables the local identity provider, but the accredited government OIDC/SAML/MFA provider remains
an external dependency. A temporary public review URL is still useful if it cannot become an
unreviewed writable deployment.

## Decision

- Public demo mode is explicit, production-only, synthetic-only, and disabled by default.
- It resolves one fixed server-owned seeded auditor identity and ignores all client identity
  headers. The ID is configuration, not a browser credential or authority claim.
- A global request hook rejects every method except `GET`, `HEAD`, and `OPTIONS` before protected
  route identity resolution. Route-level role-plus-territory authorization remains in force.
- The built React application and Fastify API share one origin. The API serves only files beneath
  the compiled web root, reserves `/api`, `/health`, and `/metrics`, and falls back to the SPA entry
  document for client routes.
- The Render Blueprint provisions only free, disposable demonstration resources, uses a managed
  database connection string, applies repeat-safe migrations and synthetic seed data, and checks
  process liveness. No local `.env`, real telemetry, official policy, or infrastructure credential
  is deployed.
- This adapter does not satisfy B-007 or B-008 and must not be reused as a production identity or
  operations design.

## Alternatives considered

- Publish the local Vite proxy and header identity; rejected because visitors could select seeded
  privileged users and invoke mutations.
- Deploy production mode without an identity provider; safe but the application would remain
  signed out and would not demonstrate the accepted workflows.
- Add a real OIDC provider for the temporary URL; correct for production direction but blocked on
  authoritative IAM, MFA, ownership, callback, and accreditation inputs.
- Split the static site and API across public origins; rejected because it adds CORS and proxy
  policy for no benefit to this temporary modular-monolith deployment.

## Consequences

- Reviewers can navigate territory-scoped synthetic dashboards, live evidence, map, analytics,
  reports, and audit history without receiving write authority.
- Actions implemented as POST, including report generation/export, intentionally fail in the
  public demo even if an older UI control remains visible.
- Free-tier sleep, database expiry, missing backups, and provider maintenance are accepted demo
  limitations and cannot support an availability or disaster-recovery claim.
- Production deployment remains blocked on the accredited identity, ingress, secrets, monitoring,
  backup, data-sovereignty, and infrastructure decisions already recorded in B-007/B-008.

## Verification

- Tests prove the public identity requires production, requires a valid fixed UUID, and ignores a
  client-supplied administrator header.
- Tests prove unsafe requests return a typed 403 before identity resolution.
- Tests prove compiled assets and SPA routes share the API origin while reserved API paths retain
  404 behavior and immutable asset caching.
- Deployment smoke checks cover liveness, readiness, authenticated session, operator shell, and a
  rejected mutation.
