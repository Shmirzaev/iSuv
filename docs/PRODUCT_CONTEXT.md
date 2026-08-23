# Product Context — Regional Water Operations Platform

## Product identity

This is not a generic analytics dashboard. It is a regional water operations, accounting, monitoring, and decision-support platform.

It receives live measurements from rivers, canals, stations, and smart-water devices; understands how water splits through the network; compares actual delivery with approved allocation; detects abnormal distribution; supports operators and field teams; and keeps an auditable government record.

The initial software must be designed for 83 top-level regional hotspots/nodes, while the architecture must accommodate substantially more stations and sensors later.

## Primary user groups

- Regional/national executives: situation awareness, allocation compliance, trends, risk, accountability.
- Basin and regional dispatchers: live operations, deviations, alarms, incidents, shift decisions.
- District operators: assigned canals/sections, acknowledgements, investigation, corrective actions.
- Hydrologists: measurement method, rating curves, validation, quality, uncertainty, corrections.
- Maintenance engineers and field technicians: device health, calibration, work orders, evidence.
- Planners: allocation plans, versions, approvals, seasonal comparisons, forecasts.
- Auditors: read-only historical records, report reproducibility, data and policy changes.
- Administrators/security staff: identity, roles, territory, integrations, system health, audit.

## Non-negotiable measurement model

### Stage

Water level/depth at a location, expressed in metres.

### Discharge

Instantaneous flow rate, expressed in m³/s.

### Volume

Accumulated delivery over a time interval, expressed in m³ and derived by integrating discharge over time when appropriate.

### Allocation deviation

Compare actual accumulated delivery against the approved plan for the same effective interval. Show both absolute and percentage variance. Do not assume a higher value is always bad without considering the plan and tolerance.

Stage may require a site-specific, versioned rating curve or direct velocity/cross-section measurement to derive discharge. The application must not pretend that depth alone equals flow or volume.

## Hydrological network/topology

The 83 hotspots are entrances into connected networks, not isolated pins.

The canonical hierarchy/graph should support:

- region and basin;
- river or main canal;
- junction/split;
- section/reach;
- gate/control structure;
- sub-canal/branch;
- measurement station;
- device and sensor;
- observation.

A junction needs parent and child waterways, upstream and downstream gauges, gate/control structures, approved allocation, measurement method, expected conveyance behavior, travel time, owner, and administrative territory.

The system must support upstream/downstream traversal and parent-child water balance. A residual difference can indicate expected conveyance/storage, measurement uncertainty, unmetered withdrawal, gate problems, data-quality failure, or a real operational issue. It must not automatically label every residual as theft or leakage.

## Observation lifecycle and data quality

Each observation must include:

- value and explicit unit;
- observation timestamp and ingestion timestamp;
- station/device/sensor;
- measurement method;
- raw payload reference where retained;
- quality flag and reason;
- uncertainty/confidence where available;
- calibration/rating-curve version;
- state: raw, automatically validated, expert validated, corrected/estimated;
- provenance and revision history.

Historical measurements are never silently overwritten. Corrections create a new auditable revision while retaining the original.

Handle duplicate, late, stale, missing, frozen, impossible, out-of-order, and manually corrected readings.

## Core application structure

### 1. Command Dashboard

Answers within seconds:

- How much water is currently available/entering?
- How much has been delivered?
- How much should have been delivered by now?
- Where are the most important over/under deviations?
- Is anything dangerous or unresolved?
- Are the measurements trustworthy?

Priority KPIs:

- regional inflow;
- delivered volume;
- planned delivery;
- allocation compliance;
- unexplained balance;
- active critical alarms;
- online stations/data completeness;
- system confidence.

Include a regional situation map, ranked deviations, planned vs actual vs previous comparable season, and selectable periods: today, week, month, irrigation season, year.

### 2. Live Operations

Operational telemetry table and station/device inspector.

Typical columns:

- station and device IDs;
- waterway/section;
- stage (m);
- discharge (m³/s);
- today/period volume (m³);
- planned volume/flow;
- variance;
- quality and confidence;
- water status;
- last update/data age;
- power/battery;
- signal/connectivity;
- calibration status;
- active alarm.

Filtering hierarchy: region → basin → waterway → section → station → device type → status → data quality.

Inspector: 24-hour trend, raw/validated data, communication health, installation metadata, calibration, firmware, alarms, maintenance history, and documents/photos.

### 3. Water Network Map

Combine two coordinated views:

- Geographic GIS view: where assets and conditions are located.
- Hydrological network view: how water is connected and split.

At regional zoom, aggregate by basin/waterway instead of showing 83 giant overlapping pins. Reveal junctions and assets progressively with zoom and filtering.

Selection side panel should show current/target discharge, difference, delivered/planned volume, deviation duration, sensor confidence, last observation, gate position if read-only telemetry exists, and responsible organization.

Status vocabulary must include:

- OVER;
- ON PLAN;
- UNDER;
- NO DATA;
- DEVICE FAULT / UNRELIABLE.

Use color plus text/icon/value. Support filters, search, clustering, upstream/downstream tracing, layers, and a time-playback abstraction.

### 4. Analytics and Forecasting

Organize by questions rather than chart types:

- delivery performance;
- allocation compliance;
- distribution equity;
- water balance and unexplained residual;
- historical/seasonal comparison;
- device/data quality performance;
- incident patterns;
- weather/season context.

Useful visual patterns include plan-vs-actual trends, cumulative delivery, waterfall balance, deviation heatmap, basin/district comparison, and quality coverage.

Forecasting and anomaly detection are later-stage advisory capabilities. Do not allow AI to directly control physical infrastructure.

### 5. Reports and Audit

Reporting is a subsystem, not only “export chart to PDF.”

Initial reports:

- daily regional water situation;
- allocation compliance;
- canal water balance;
- delivery by district;
- over/under incidents;
- station availability;
- device/communication health;
- calibration compliance;
- seasonal water balance;
- year-over-year water use;
- per-incident report;
- management executive report;
- audit and data-correction report.

A report records version, period, data cutoff, data snapshot/revision, calculation methodology, quality state, generator, approver, and generation time. Historical reports must be reproducible.

### Global Alarm and Incident Center

Available from all screens as a panel/full-screen workspace.

Alert logic includes validation, stage-to-flow conversion where needed, discharge-to-volume integration, travel-time/network logic, allocation comparison, parent-child balance, persistence, confidence, and severity.

Never alert from one bad spike alone. Use physical plausibility, quality, rate of change, adjacent stations, configurable tolerance, persistence duration, and hysteresis.

Severity is separate from water status:

- information;
- advisory;
- warning;
- critical.

Alarm lifecycle: created → acknowledged → investigated → assigned → corrective action → cleared → incident closed → included in reporting.

Event classes include over/under allocation, unexplained balance, sudden flow change, high stage, dry canal, frozen/impossible sensor, communication loss, power problem, overdue calibration, gate mismatch, and upstream/downstream inconsistency.

Maintain two parallel conditions: water condition and system/device condition.

## Allocation Management

Allocation is a core engine behind the application.

Plans can be daily volume or time-window discharge targets. They are version-controlled and effective-dated.

A plan change stores previous/new values, reason, requester, approver, effective time, and legal/administrative reference. Historical compliance must use the plan version that was valid at the time.

Tolerances are configurable by waterway, season, policy, uncertainty, and agreement; they are not one global hard-coded percentage.

## Security and governance

- Role plus territory scope.
- Least privilege and separation of duties.
- MFA-ready identity integration.
- Complete audit of login, export, reports, allocation/threshold changes, alarms, device configuration, calibration, corrections, commands, and permissions.
- OT/IT separation. Web applications must not directly expose PLCs, RTUs, gates, pumps, or valves.
- Encryption, secure device identity, network controls, backups, recovery, monitoring, and incident procedures.
- Government ownership of data model, historical data, GIS topology, API specifications, alert definitions, allocations, and export formats.
- Open APIs and replaceable vendor adapters.
- Uzbek/Russian/English-ready UI.
- WCAG 2.2 AA behavior.

## Reliability and field operation

Critical stations should buffer measurements locally through communication outages, preserve timestamps, retry, and synchronize missing observations later.

Future field workflows should support mobile/offline inspection, QR/device identification, calibration, photos, work orders, GPS evidence, parts, and later synchronization.

## MVP boundary

The software MVP demonstrates the complete operational workflow with clearly labeled synthetic data:

- configurable topology for 83 top-level hotspots and realistic child branches;
- station/device registry;
- telemetry simulator and ingestion adapter;
- time-series history and quality flags;
- approved allocation plans;
- stage/discharge/volume distinction;
- parent-child balance and deviation calculations;
- alerts and incident lifecycle;
- dashboard, live table, GIS/network map, analytics, and reports;
- RBAC/territory controls and audit logs;
- reproducible local environment and tests.

The MVP does not claim real hydrological accuracy without official station methods, rating curves, geometry, calibration, plans, and device payloads. It does not control physical infrastructure.
