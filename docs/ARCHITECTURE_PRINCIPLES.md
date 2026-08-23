# Architecture Principles

These are constraints, not a forced vendor stack. Preserve a sound existing implementation. For a greenfield repository, choose current stable technologies and document them in ADRs.

## Logical layers

1. Field and edge: sensors, meters, RTUs/gateways, local validation, timestamping, buffering, retry/replay.
2. Secure ingestion: device identity, protocol adapters, broker/queue, schema validation, idempotency.
3. Water intelligence: validation, optional stage-to-discharge conversion, time-series processing, volume integration, travel-time alignment, topology balance, allocation rules, alarms.
4. Operational data: time-series observations, relational/governance data, geospatial topology, immutable/revision history, object/document storage.
5. APIs and integration: versioned application APIs, GIS/IoT interoperability boundaries, export and reporting interfaces.
6. Government application: dashboard, live operations, GIS/network, analytics, reports, global alarm/incident center, administration.

## Greenfield reference shape

The architect may choose an equivalent stack, but a practical default is:

- TypeScript web frontend with a production React framework;
- Python or TypeScript API/service layer chosen through an ADR;
- PostgreSQL with PostGIS and a time-series strategy/extension or clearly separated time-series store;
- MQTT-compatible broker adapter for telemetry simulation and later devices;
- cache/queue only where justified;
- S3-compatible object/document storage abstraction;
- containerized local environment;
- OpenAPI/typed contracts;
- MapLibre or another open GIS renderer;
- vendor-neutral adapter boundaries for SensorThings/WaterML and legacy SCADA/industrial protocols.

Do not create distributed complexity merely for appearance. Start as a modular, well-tested deployment that can split services when scale and operations justify it.

## Data boundaries

- Time-series observations are append-oriented and revision-aware.
- GIS/topology has explicit geometry and graph relationships.
- Governance data includes plans, approvals, users, incidents, reports, and maintenance.
- Large documents/photos/reports use object/document storage.
- Domain calculations are deterministic and independently testable.

## Security boundary

OT/device networks and physical controllers are separate from the government web/IT application. The MVP consumes telemetry through controlled adapters and has no direct physical control path.

## Interoperability and ownership

The government must be able to export historical measurements, topology, plans, alerts, audit records, reports, and configuration in documented formats. Avoid undocumented proprietary representations and single-vendor coupling.

## Resilience

Support delayed/offline telemetry, replay, idempotency, explicit stale/no-data state, backups, recoverability, health checks, and graceful degradation.
