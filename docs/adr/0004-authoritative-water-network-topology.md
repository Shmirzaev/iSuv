# ADR-0004: Authoritative Water-Network Topology

- Status: Accepted
- Date: 2026-08-23
- Owners: Primary agent

## Context

The platform must traverse upstream and downstream relationships, support both splits and merges, calculate parent/child balances later, protect territory-scoped data, and render synthetic GIS data without presenting it as official. Administrative territories and hydraulic basins do not form the same hierarchy. Duplicating edge direction in multiple tables would also permit the stored graph and its validation surface to diverge.

## Decision

Use `network_junctions` as hydraulic nodes and `water_sections` as the single authoritative directed edges. A section stores its nominal/accounting upstream and downstream junctions explicitly; geometry never determines connectivity or flow direction. Branches and merges are valid, while self-loops and directed cycles are rejected by PostgreSQL under an organization-scoped advisory transaction lock so concurrent reciprocal inserts cannot bypass validation.

Keep hydraulic membership separate from the administrative `territories` authorization hierarchy. Every record has a responsible territory, but same-organization sections may connect junctions with different responsible territories. Territory-scoped reads redact foreign endpoint identifiers and expose only non-identifying boundary flags.

The boundary-redacted topology is an external/UI read model, not a calculation source. Later travel-time, water-balance, and allocation services must query the canonical section graph through a separately authorized internal repository so a valid cross-territory network is never treated as disconnected.

Use WGS84 PostGIS geometry with entity-specific types: `Point` for junctions/stations/control structures, `LineString` for waterways/sections, and `MultiPolygon` for regions/basins. Geometry must be non-empty, valid, and contain only longitude/latitude coordinates within WGS84 bounds. Topological relationships remain authoritative even where geometries cross or touch.

Control structures are monitoring and decision-support metadata only. Device-to-station installations are effective-dated so later relocation does not rewrite historical provenance. Sensor master data constrains stage to metres, discharge to m³/s, and accumulated volume to m³; rating curves and observations remain separate versioned boundaries.

## Alternatives considered

- Parent/child waterway tree: rejected because it cannot represent confluences and realistic split/merge networks.
- Separate section and graph-edge tables: rejected because direction and cycle validation could diverge.
- Geometry-derived connectivity: rejected because proximity/intersection is not authoritative hydraulic evidence.
- Forcing all connected assets into one administrative territory: rejected because waterways and basins can cross authorization boundaries.
- Allowing cycles in the accounting graph: deferred; future recirculation or return-flow modeling requires explicit governed balance terms.

## Consequences

- The MVP accounting topology is a directed acyclic graph, not a claim that every physical system is acyclic.
- Cross-territory continuity can be stored without leaking another territory's asset identity through scoped APIs.
- Official GIS geometry, network ownership, flow direction, travel time, and calibration remain external rollout inputs; synthetic fixtures must be labeled.
- Later balance and travel-time calculations can use stable, deterministic graph traversal.

## Verification

- Database tests accept branch/merge diamonds and reject self-loops, direct cycles, and concurrent reciprocal sections.
- Foreign keys reject cross-organization references while cross-territory boundary sections remain valid.
- API tests prove same/ancestor/cross-territory authorization and boundary redaction.
- Database and contract tests reject invalid geometry types, empty geometry, and out-of-range WGS84 vertices.
- Database and contract tests reject mismatched stage/discharge/volume units, and route tests prove no physical-control command path exists.
