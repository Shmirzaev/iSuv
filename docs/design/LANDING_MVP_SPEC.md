# iSuv Creative Landing MVP — Design Specification

## Purpose

Validate the visual language, narrative structure, and smooth-transition direction before building the complete iSuv product landing experience.

## Creative concept

**From river to decision.** A single luminous water line carries the visitor through the product story:

1. Live flow enters the monitored region.
2. The main canal splits into connected branches.
3. The camera moves toward abnormal node A-07.
4. Station telemetry expands into the regional command dashboard.
5. A validated deviation becomes an acknowledged operational incident.
6. The product resolves into three layers: Measurement, Water Intelligence, and Government Operations.

The sequence borrows the general interaction grammar of premium scroll-led product films—object continuity, camera zoom, mask/reveal, and UI morphing—without copying any referenced site or video.

## Visual system

- Deep navy operational environment, not generic black SaaS styling.
- Cyan/blue river paths represent trusted live flow.
- Amber indicates over-plan conditions; red is reserved for incident severity.
- Fine topographic contours and GIS grids create regional context.
- Glass surfaces are used sparingly for telemetry overlays, with solid operational panels for core data.
- System typography, large editorial headlines, compact monospaced-like metadata styling.

## Story scenes

### Scene 1 — Flow

Draw the main canal and introduce live telemetry. Explain stage, discharge, and volume as distinct measurements.

### Scene 2 — Split

Reveal three downstream branches and their textual statuses: OVER, ON PLAN, UNDER. Status never relies on color alone.

### Scene 3 — Station zoom

Zoom into A-07 and show:

- stage: 1.82 m;
- discharge: 8.74 m³/s;
- delivered today: 524,310 m³;
- planned today: 491,000 m³;
- deviation: +6.8%;
- duration: 47 minutes;
- data confidence: high.

All values are synthetic.

### Scene 4 — Dashboard and incident

Morph the station card into Command Dashboard and slide in an alarm card. The acknowledgement interaction changes state and records a responsible operator in the visible demo.

### Scene 5 — Product architecture

Stack three layers:

- Measurement Layer;
- Water Intelligence;
- Government Operations.

## Page continuation

- Full-size command center mockup.
- Five product workspaces.
- Data governance and trust principles.
- Final “Do not guess where the water is going. See it.” CTA.

## Accessibility and motion

- Motion On/Off control.
- `prefers-reduced-motion` support.
- Keyboard-focus treatment and skip link.
- Semantic headings and labeled interactive elements.
- Text/icon/value accompany status colors.

## Technical implementation

- Dependency-free HTML, CSS, and JavaScript.
- Sticky scroll stage driven by `requestAnimationFrame`.
- SVG path drawing and moving flow particles.
- Intersection Observer for below-the-fold reveals.
- Transform/opacity-focused animation for performance.
- Node built-in static server and smoke tests.

## Approval boundary

This prototype does not implement backend, authentication, telemetry ingestion, GIS services, allocation management, reports, or real device control. Full product execution should begin only after the visual MVP is approved.
