# ADR-0013: Supplied regional references remain separate from operational observations

Date: 2026-09-13. Status: Accepted.

## Context

The user supplied two Savay registers, four raster maps, an Andijan PDF map and a CorelDRAW file and requested their integration. The Excel files have no observation dates, device identities, coordinates or approval history. Several fields are ambiguous. The maps are illustrations without a supplied coordinate reference system or station-to-row crosswalk. Register sequence numbers cannot safely be joined to numbered map features.

## Decision

Add a version-controlled `user_supplied_reference` snapshot and browser map assets, with source SHA-256 fingerprints and exact sheet/row/cell/formula evidence. Present them as the default regional map and searchable register. Keep the existing synthetic network available explicitly and preserve existing sensor UUIDs, observation history, governed plans, reports and audit records.

These supplied references are intentionally viewable reference material in the demo client, not protected operational records or an ingestion endpoint. Do not include personal contact details, secrets, original opaque CDR contents, or unrelated source-folder material. A subsequent authorized publication will include only the normalized register and optimized map images, not originals. New operational imports must use the existing server authorization and governance boundaries.

The snapshot does not assign WGS84 coordinates, create stations/devices, approve allocation limits, infer network edges from row order, feed alarms or combine annual volumes. Missing discharge stays null even when an Excel formula cached zero. The annual-volume column remains an original entry with unconfirmed scale. The present/absent/missing smart-water field describes the inventory statement, not connectivity.

## Consequences

The project immediately gains useful regional context without rewriting accepted synthetic history. Reference updates are reproducible through import scripts and Git revisions. B-002 is partially addressed by maps and names; accurate geography, topology, official status and record crosswalk still require source-owner confirmation. A PDF/SVG export of the CorelDRAW source remains necessary for detailed review without a local CDR decoder.

## Alternatives

Renaming the 83 demo sensors to spreadsheet rows would falsely associate fabricated observations with actual places. Guessing coordinates or matching map numbers to row numbers would invent a spatial relationship. A full GIS digitization and governed operational import needs coordinates, entity identities, dates and source approval that were not supplied.
