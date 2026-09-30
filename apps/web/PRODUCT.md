# Product

<!-- impeccable:product-schema 1 -->

<!-- Derived from repository docs (AGENTS.md, docs/PRODUCT_CONTEXT.md, docs/ACCEPTANCE_CRITERIA.md) and the user's request to redesign so it does not look AI-made. Not yet interviewed; user confirms via the direction round. -->

## Platform

web

## Users

Regional and national water executives (situation awareness, accountability); basin and regional dispatchers (live operations, alarms, shift decisions); district operators and field engineers (assigned canals, acknowledgements, device health); hydrologists, planners, auditors and administrators. Uzbek-speaking government water-management staff first, then Russian and English. They work in dispatch/control rooms and offices on large monitors, and on laptops and phones in the field.

## Product Purpose

iSuv (Savay) is a regional water operations, accounting, monitoring and decision-support platform for Uzbekistan's Andijan/Fergana region. It ingests live telemetry (stage in m, discharge in m³/s, delivered volume in m³), models the upstream/downstream network of 83 top-level hotspots, compares approved allocations with actual delivery, flags trustworthy over/under distribution, runs alarms and incidents, and keeps an auditable history. Version 1 is monitoring and decision support only; it never controls gates, pumps or valves.

## Positioning

Not a generic analytics dashboard. It treats water as a network with an allocation ledger: every reading carries unit, quality, provenance and correction history, and no-data or unreliable data never looks normal.

## Operating Context

Workspaces: Command Dashboard, Live Operations (telemetry table and station inspector), Map & Network (GIS plus hydrological topology), Analytics, Reports, Alarm and Incident Center, Audit Explorer, Allocation management. The map workspace uses supplied source-faithful regional maps (Andijan detailed PDF, irrigation map, Savay project area) as an interactive atlas. Local time presentation with UTC internally.

## Capabilities and Constraints

Status vocabulary: OVER, ON PLAN, UNDER, NO DATA, DEVICE FAULT / UNRELIABLE, never by colour alone (text, icon and value too). Alarm severity (information, advisory, warning, critical) is separate from water status. Units are never conflated. Uzbek, Russian and English localization. WCAG 2.2 AA. Role plus territory scope. Synthetic demo data must be clearly labelled and never presented as real government telemetry. Existing stack: React + Vite web app (`apps/web`), CSS in `apps/web/src/styles.css`; keep working behavior, tests and i18n.

## Brand Commitments

Product name: iSuv. No confirmed logo, government brand book or palette. Open decision.

## Evidence on Hand

Supplied source maps under `apps/web/public/regional-maps/` and the Excel-derived regional reference register. No real telemetry, official plans or calibration data: everything shown is labelled synthetic.

## Product Principles

1. Trust before polish: data quality, provenance and no-data states are first-class, never decoration.
2. Answer the operator's question in seconds: how much is entering, delivered, planned, deviating, unresolved.
3. Water status and device status are separate conditions and must never blur together.
4. Government-grade: calm, auditable, legible under pressure, with no hype or gamification.

## Accessibility & Inclusion

WCAG 2.2 AA; status never by colour alone; Uzbek/Russian/English with Cyrillic and Latin Uzbek text needing full glyph coverage in any chosen face.
