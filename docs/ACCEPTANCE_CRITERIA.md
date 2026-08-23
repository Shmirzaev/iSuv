# Acceptance Criteria

Items marked **MVP REQUIRED** define the software completion boundary for the first autonomous Codex build.

## A. Repository and local environment — MVP REQUIRED

- A new developer can start the documented local stack from a clean checkout using repeatable commands.
- `.env.example` contains names and safe defaults but no secrets.
- Database migrations and seed commands are repeatable and idempotent where appropriate.
- Health/readiness checks exist for the application services.
- Formatting, linting, typing, tests, and build commands are documented and executable.
- CI or an equivalent local verification script runs the required checks.

## B. Domain and master data — MVP REQUIRED

- Typed entities exist for organization/territory, region, basin, waterway, junction, section, control structure, station, device, sensor, observation, allocation plan/version, threshold/rule, alarm, incident, maintenance record, user/role, report, and audit event.
- Stable human-readable and internal identifiers are supported.
- Parent/child topology prevents invalid cycles or detects them during validation.
- Seed data creates 83 clearly synthetic top-level hotspots with child networks sufficient to demonstrate all views.
- Synthetic data is visibly labeled in UI and reports.

## C. Measurement integrity — MVP REQUIRED

- Stage uses metres, discharge uses m³/s, and volume uses m³ in schema, API, tests, UI, and reports.
- Observation and ingestion timestamps are separate and timezone-safe.
- Each observation includes device/sensor identity, unit, state, quality/provenance, and revision information.
- Duplicate/idempotent ingestion behavior is tested.
- Late/out-of-order, stale, missing, frozen, impossible, and corrected/estimated data have defined handling and tests.
- Historical correction preserves the original and creates an audit trail.
- Stage-to-discharge conversion is behind a versioned adapter/model boundary; the MVP can use documented synthetic rating curves but must not claim universal validity.

## D. Telemetry — MVP REQUIRED

- A simulator emits realistic, configurable telemetry for normal, over, under, stale, offline, spike, frozen, and device-fault scenarios.
- An ingestion interface accepts simulator data and is designed for later MQTT/industrial adapters.
- Local buffering/replay behavior is represented or documented at the edge boundary.
- Live data updates the application without a full-page reload.
- Device last-seen, signal/power placeholders or values, and quality are exposed.

## E. Allocation and water accounting — MVP REQUIRED

- Allocation plans are effective-dated, versioned, and approval-aware.
- Plan changes preserve previous values, reason, requester, approver, effective time, and reference.
- Actual volume is compared with the plan for the same interval.
- Absolute and percentage deviation are calculated and tested.
- Parent-child balance supports legitimate loss/storage terms and an unexplained residual.
- Travel-time/time-alignment is represented in the model and calculation boundary; synthetic scenarios demonstrate it or explicitly mark it unconfigured.
- Tolerances are configurable by network scope and time/season, not hard-coded globally.

## F. Alarms and incidents — MVP REQUIRED

- Water status and alarm severity are separate concepts.
- Rules can use quality, tolerance, persistence, rate of change, and hysteresis.
- A single invalid spike does not create a false critical alert in tests.
- Event types include over/under allocation, unexplained balance, sudden flow change, high stage, dry canal, sensor frozen/impossible, communication loss, power, overdue calibration, and network inconsistency.
- Alarm workflow supports create, acknowledge, assign, comment, resolve/clear, close incident, and timeline/audit.
- Escalation metadata and response-time metrics are represented.

## G. Command Dashboard — MVP REQUIRED

- Shows regional inflow, delivered volume, planned delivery, allocation compliance, unexplained balance, critical alarms, stations/data online, and system confidence.
- Shows the most important deviations with magnitude, duration, and data quality.
- Shows planned vs actual vs previous comparable period using clearly labeled synthetic data.
- Time ranges include at least today, week, month, season, and year abstractions.
- Users can drill from a KPI/deviation into the relevant map/live detail.

## H. Live Operations — MVP REQUIRED

- Table includes station, device, waterway/section, stage, discharge, volume, plan, variance, quality, water status, last update/data age, power/signal, calibration, and alarm.
- Hierarchical and status/data-quality filters work.
- Row selection opens a detail inspector without losing list context.
- Inspector includes recent trend, raw/validated state, device health, metadata, calibration, alarms, and maintenance placeholders/history.

## I. GIS and network map — MVP REQUIRED

- Regional zoom aggregates rather than rendering 83 oversized overlapping pins.
- Users can progressively reveal waterways, junctions, stations, and sections.
- Geographic view and connected network/topology view are coordinated.
- Selection panel shows current/target discharge, delivered/planned volume, variance, deviation duration, confidence, last observation, and responsible territory.
- Upstream/downstream traversal works for seeded topology.
- Status uses label/icon/value plus color and includes OVER, ON PLAN, UNDER, NO DATA, and DEVICE FAULT/UNRELIABLE.
- A temporal playback abstraction exists for synthetic history.

## J. Analytics — MVP REQUIRED

- Planned vs actual analysis works by region/basin/waterway/section and period.
- A water-balance view exposes intake, measured deliveries, expected terms, and unexplained residual.
- A deviation heatmap or equivalent reveals systematic over/under behavior.
- Data-quality and station-availability analysis is included.
- No AI/forecast result is presented as operational truth; later-stage forecasts are clearly separated or omitted.

## K. Reports and audit — MVP REQUIRED

- Generate at least daily situation, allocation compliance, water balance, device availability, incident, and executive summary reports from seeded data.
- Reports include version, period, cutoff, data snapshot/revision, methodology identifier, quality state, generator, approver status, and generation time.
- A report snapshot can be regenerated/retrieved without silently changing when source data is later corrected.
- Export at least PDF or print-ready output plus CSV/Excel-compatible tabular export where relevant.
- Critical administrative and operational changes appear in searchable audit history.

## L. Identity, authorization, and security — MVP REQUIRED

- Roles include at minimum national/system admin, regional director, basin dispatcher, district operator, hydrologist, maintenance engineer, and auditor.
- Authorization combines role and territory scope.
- Tests prove one district cannot modify another district’s allocations/incidents/devices.
- Privileged actions are auditable and designed for MFA-capable identity integration.
- No secret is committed.
- The web/API layer has no direct physical control command path in the MVP.
- Dependency and basic application security checks have no unresolved critical findings.

## M. Accessibility and localization — MVP REQUIRED

- Status is not conveyed by color alone.
- Primary workflows are keyboard reachable and have accessible labels.
- Contrast and focus behavior are designed toward WCAG 2.2 AA.
- User-facing strings are localization-ready for Uzbek, Russian, and English; at least core navigation/status vocabulary is demonstrated in all three.

## N. Observability and resilience — MVP REQUIRED

- Structured application logs and correlation/request IDs exist where appropriate.
- Service and ingestion health are visible.
- Telemetry lag, online/offline status, errors, and rule failures are observable.
- Backup/restore and disaster-recovery expectations are documented and a local backup/restore smoke procedure is provided.
- Degraded operation and missing-data behavior are explicit.

## O. Full rollout dependencies — NOT CODEX-COMPLETE WITHOUT EXTERNAL INPUT

- Official GIS geometries and asset registry.
- Real device manufacturers, payloads, protocols, certificates, and connectivity design.
- Site-specific rating curves, cross-sections, calibration, uncertainty, and maintenance policy.
- Legally approved allocation plans, tolerances, escalation rules, and organizations.
- Government identity provider, data-sovereignty decision, infrastructure, security accreditation, and operational SOPs.
- Production high availability, disaster-recovery sites, field hardware, and network segmentation.
- Human-reviewed remote-control safety case; remote gate/pump/valve control remains out of MVP scope.
