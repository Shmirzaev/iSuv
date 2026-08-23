# ADR-0003: Telemetry and OT Security Boundary

- Status: Accepted
- Date: 2026-08-23
- Owners: Primary agent

## Context

The MVP has no authorized real device protocols, certificates, OT network, or safety case. It must demonstrate live and replayed telemetry without creating a physical-control path or coupling domain logic to a vendor protocol.

## Decision

- Define a versioned inbound `TelemetryAdapter` port. The MVP implements a configurable simulator adapter and direct application ingestion; future MQTT, SensorThings, WaterML, SCADA, or industrial adapters map into the same canonical contract.
- Represent edge buffering through stable source-event identities, original device timestamps, delayed delivery, retry, and replay scenarios. The application guarantees idempotent ingestion and explicit late/out-of-order state.
- Use server-sent events for one-way live operator updates in the MVP. Reconsider only if measured interaction requirements need bidirectional transport.
- Expose no API, UI action, job, message type, or database command path that can operate gates, pumps, valves, PLCs, or RTUs. Read-only control-structure position telemetry is permitted and must be labeled as telemetry.
- Treat any future OT/control integration as a separate security and safety architecture requiring authorized inputs, network segmentation, dual approval, independent physical verification, and a new ADR outside the MVP.

## Alternatives considered

- Deploy an MQTT broker in the initial local stack: deferred because a simulator-to-port implementation proves contracts and replay behavior without unsupported infrastructure.
- WebSockets: deferred because live telemetry is one-way to the browser for current workflows.
- Direct vendor SDK or PLC integration: rejected as unsafe, unavailable, and outside the accepted MVP scope.

## Consequences

- Simulator fixtures are the only telemetry source initially and are visibly synthetic/non-authoritative.
- Adapters own protocol translation; domain services consume canonical typed observations.
- The government web/API environment remains separated conceptually and technically from future OT networks.
- Real integration remains blocked by B-003 and requires security accreditation and authoritative device inputs.

## Verification

- Adapter contract tests cover normal, replay, duplicate, late, stale, frozen, spike, offline, and fault events.
- Source inspection and security tests confirm no physical-control command route or message exists.
- SSE smoke tests show live updates without full-page reload.
- Documentation describes the edge retry/replay and OT/IT boundary.
