# ADR-0016: Integrate the supplied Andijan water-network map

Date: 2026-09-30. Status: Accepted.

## Context

The supplied `tmp/andijon-source` project contains a Leaflet water-network map at source commit `1ff7235`. Its self-contained `index.html` embeds the vector data, district-clipped collections, scanned-overlay metadata and statistics. The supplier marks the source code and map data confidential and states that they must not be placed on a public site.

## Decision

Integrate the map as a new lazy-loaded Map workspace tab. Preserve the Leaflet layer definitions, geometry, source colours, widths, dashes, panes, z-order, district clipping, search and fly-to behaviour from the supplied map. Restyle only application and Leaflet chrome in the Limnigraph Register design system. The map remains reference geometry: it conveys no live observations, device state, telemetry or derived operational status.

The four embedded JSON data literals and the supplied PNG overlays are committed under `apps/web/public/andijon-map/` by the user's explicit decision. `scripts/extract-andijan-map-data.mjs` is the repeatable, non-evaluating extraction process. The Map workspace lazy-loads the static data when its tab opens, so it does not inflate the main application bundle.

Use the already installed Leaflet npm package and retain the original Esri basemap services and their attribution. The original layer data, map styling and scanned overlays are not recoloured or changed by application theming.

## Consequences and risk

The public Render deployment creates a confidentiality risk because the source explicitly prohibits public publication of these detailed canal and infrastructure data. A straight confidentiality notice is shown in the workspace, but it cannot substitute for deployment access control. Before public deployment, the operator must either restrict access or remove this tab and its static assets.

The source's accuracy caveats remain visible: vectorised/scanned layers are approximately ±300–500 m, schematic points approximately ±2–3 km, and irrigation-system zones approximately ±1–3 km. Map data may overlap across sources and is not an authoritative surveyed or live operational network.
