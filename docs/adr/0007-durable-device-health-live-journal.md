# ADR-0007: Durable device health and bounded live journal

- Status: Accepted
- Date: 2026-08-24

## Context

The MVP must expose live device state without confusing device communication, numerical data trust, and reported hardware faults. Clients must resume after an API restart, while the current local deployment has no broker and official device cadence, heartbeat, power, signal, or fault-clear policy is unavailable. Territory relocation also means current asset scope cannot safely authorize historical facts.

## Decision

Persist append-only device-health facts, a current projection, and a monotonic PostgreSQL live-event journal. Accepted numerical observations and status-only device events update the projection and journal in the same database transaction as their source write. Numerical observations retain their original revision-one receipt for `lastSeenReceivedAt`; later validation or correction may update data trust but cannot impersonate a new device communication. `lastObservedAt` remains the numerical source timestamp.

Connection status, numerical data condition, and device fault are independent. Without approved cadence policy, freshness remains `unconfigured`; `no_data` is represented but never synthesized. Numeric evidence cannot clear an explicit reported fault. Power and signal use tagged unknown/measured values, and synthetic classification is preserved conservatively across source, device, and historical installation provenance.

Serve live updates as bounded reconnecting SSE batches backed by the durable journal. `Last-Event-ID` is a stable bigint cursor, replay is capped, expired cursors receive an explicit snapshot resynchronization event, and empty deltas return a heartbeat. This avoids unbounded per-client queues while surviving process restart. History and live queries authorize occurrence-time territories before applying limits or cursors; current health remains authorized against current territory.

## Alternatives considered

- A process-local event emitter was rejected because restart loses replay state and post-commit ordering.
- WebSockets were rejected because this slice is server-to-client delivery and still needs a durable resume source.
- MQTT, Kafka, or another broker was deferred because the single-process local MVP does not justify distributed infrastructure; later horizontal scale may add an outbox consumer without changing the journal contract.
- Deriving health only at read time was rejected because it cannot preserve status-only offline/fault evidence or deterministic historical authorization.

## Consequences

- Device health is auditable, restart-resumable, transactionally aligned with accepted telemetry, and cannot manufacture water measurements.
- Slow clients reconnect instead of consuming unbounded API memory; horizontal multi-instance fan-out remains a later deployment decision.
- Official cadence, device status meanings, fault-clear authority, and power/signal units remain rollout inputs. Until supplied, states remain visibly synthetic or unconfigured.
- Historical relocation requires occurrence-scoped authorization rather than a single current-territory gate.

## Verification

Fresh migrations and repeat seed, raw migration replay, source-race tests, correction/validation liveness tests, fault-priority tests, classification tests, relocation/keyset/replay tests, degraded-database tests, the full database suite, and domain/QA/reviewer gates must pass.
