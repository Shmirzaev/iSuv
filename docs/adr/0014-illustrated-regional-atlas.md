# ADR-0014: Interactive reference atlas in illustration coordinates

Date: 2026-09-13. Status: Accepted.

## Context

The user rejected a gallery-only map view and requested clickable areas that zoom into districts and rivers, with image-generated artwork. The supplied maps show related regional views at different scales, but contain no coordinate reference system or authoritative asset-to-register crosswalk. ADR-0013 continues to prohibit invented station coordinates or operational observations.

## Decision

Use a small SVG atlas in the existing React application. Andijan's five irrigation-system areas navigate to a closer view; Savay–Oqbura opens a separate source-scale scene with three drawn district areas and eight named waterways. Each scene records its source image and pixel dimensions. Paths are approximate manual visual tracings, not WGS84 or surveyed boundaries. The navigation hierarchy is presentation-only, not the directed accounting network or authorization territory tree. Source comparison is available in the same coordinate space, and all five original previews remain under a collapsed source viewer.

Use built-in image generation only for low-contrast terrain artwork. Do not extract geographic evidence from an AI image. Rivers, areas, labels, selection, pan and zoom are code layers. Display a persistent approximate-reference badge. The generated image is decorative and not a claim about actual elevation. No AI-generated labels, sensors, observations or geographic coordinates enter the domain dataset.

Link the explicitly named Savay and Oqbura waterways to the matching named spreadsheet sections (61 and 3 records respectively). Do not match numbered source map points to spreadsheet sequence numbers or position individual intake records. Other waterways state that no spreadsheet records were supplied. All original cells, dates-as-missing and quantity caveats from P8-001 remain unchanged.

## Alternatives and consequences

A generated map alone remains a non-interactive picture and may invent geographic details. Replacing this with a georeferenced operational GIS would require B-002 inputs. The reference SVG provides immediate, reversible drill-down without new dependencies or changes to database, API, permissions or alarm/accounting logic. The coarse paths must be replaced or refined through reviewed source data before use for geographic measurement, official boundaries, routing or infrastructure decisions. No real device control or deployment is introduced.

The user explicitly prohibited subagents. Implementation, source comparison, risk review and verification are performed by the primary agent for this task.
