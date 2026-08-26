# iSuv Creative Landing MVP — Design Specification

## Purpose

Create an approval-gated landing-page direction before the production platform UI begins. The page presents iSuv as a regional water operations, accounting, monitoring and decision-support platform rather than a generic dashboard.

## Narrative

1. **Regional network** — a live main canal branches into monitored sections.
2. **Spatial drill-down** — the view focuses on Section A-07 while preserving network context.
3. **Telemetry inspector** — actual discharge, target discharge, delivered volume, variance and confidence appear together.
4. **Command center morph** — the inspector expands into a regional dashboard with KPIs, situation map and ranked deviations.
5. **Alarm-to-action** — a persistent, high-confidence variance becomes an assigned incident.
6. **Three platform layers** — Measurement → Water Intelligence → Government Operations.
7. **Auditability** — corrections, plans, alarms and reports retain a traceable history.

## Motion direction

- A sticky scroll-controlled story with reversible, eased transitions.
- The water path draws first; camera movement then focuses on a monitored section.
- Inspector and command-center surfaces morph from the same spatial context.
- Motion uses transforms and opacity, with a runtime motion toggle and reduced-motion fallback.
- Mobile keeps the same narrative but simplifies spatial composition and hides low-value detail.

## Visual direction

- Deep water/command-center palette; bright aqua indicates trusted live flow.
- Orange/amber indicates over/under conditions but status is always shown with text and values.
- Original abstract SVG network; no external copyrighted visual assets.
- High contrast, visible focus behavior, semantic headings and a skip link.

## Approval boundary

This MVP does not begin backend, GIS, database, device integration or the full operator application. It uses synthetic values and remains a standalone prototype until explicitly approved.
