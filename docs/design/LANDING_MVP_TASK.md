# Claude Code Task — iSuv Creative Smooth-Transition Landing MVP

## Scope and stopping rule

Build only a coded, approval-gated landing-page MVP for iSuv. This task temporarily pauses the normal P0–P7 autonomous platform loop.

Do not start backend, authentication, database, telemetry ingestion, production GIS, real dashboards, or physical-control functionality. When the landing MVP is working, tested, documented, screenshotted, and committed, start the local preview, report its URL and review artifacts, then stop and wait for explicit `APPROVED` or revision instructions.

## Creative references

Use these only as motion inspiration, never as assets or frame-for-frame copies:

- https://youtube.com/shorts/YGk4H5v29PY
- https://youtube.com/shorts/_-Eo8G3CYWc
- https://youtube.com/shorts/LQOona1NXrE
- https://youtube.com/shorts/DxVXMSv9Yp0

The original iSuv experience should combine object-led transitions, pinned scroll storytelling, camera-like zoom, shared-element morphs, restrained parallax, one or two liquid/SVG wipes, and meaningful dashboard assembly. Every scroll-linked transition must reverse cleanly. Preserve native keyboard/touch scrolling; do not trap the page.

## Product truth

iSuv is a regional water operations, accounting, monitoring, and decision-support platform, not a generic analytics dashboard. It receives measurements from rivers, canals, stations, and devices; understands connected upstream/downstream topology; compares actual delivery with approved allocation; detects trustworthy over/under distribution and data-quality problems; supports alarms/incidents; and preserves an auditable record.

All displayed values must be clearly labeled synthetic/demo data. Keep stage in metres, discharge in m³/s, and accumulated volume in m³ distinct. Never imply that stage alone equals flow or volume. Never imply direct or autonomous control of real gates, pumps, valves, PLCs, or RTUs.

## Visual direction

Create a premium, calm, precise, government-grade digital-water experience. Use dark atmospheric surfaces, crisp operational data, generous editorial typography, subtle contours/grid geometry, restrained glass, and original inline SVG/CSS network artwork. Avoid a generic SaaS card grid, gaming/crypto aesthetics, excessive glow, stock dashboard screenshots, stock river photography, autoplay video, Lottie packs, and copied illustrations.

Suggested tokens:

- background `#031018`
- elevated navy `#071D2A`
- panel `rgba(9,35,48,.72)`
- water cyan `#19D3C5`
- operational blue `#3A8DFF`
- primary text `#F3F8FA`
- secondary text `#A9BDC7`
- safe `#45D483`
- warning `#F3B84B`
- critical `#FF5C68`

## Required connected chapters

### 1. Persistent navigation

Original iSuv wordmark; anchors `Platforma`, `Tarmoq`, `Monitoring`, `Xavfsizlik`; UZ/RU/EN selector; visible Motion On/Off control; CTA `Platformani ko‘rish`. UZ is default.

### 2. Hero

Eyebrow: `HUDUDIY SUV OPERATSIYALARI PLATFORMASI`

Headline: `Har bir kub metr — nazorat ostida.`

Supporting copy: `iSuv jonli o‘lchovlarni suv tarmog‘i bo‘yicha tushunadi, tasdiqlangan reja bilan solishtiradi va muhim og‘ishlarni vaqtida ko‘rsatadi.`

Show `SINTETIK DEMO MA’LUMOTLARI`, `83 monitoring nuqtasi`, `24/7 jonli telemetriya`, `UZ · RU · EN`.

Animate one cyan river path into view. As scrolling begins, the camera follows that same river into the connected network chapter.

### 3. Connected water network

Heading: `Suv qayerga ketayotganini ko‘ring.`

Pinned scene: one main canal divides into three branches with labels attached to the geometry.

Main canal actual `24.50 m³/s`, plan `24.00 m³/s`.

- A-07: `8.74 m³/s` vs `8.20 m³/s`, `+6.6%`, `OVER`
- B-12: `10.11 m³/s` vs `9.30 m³/s`, `+8.7%`, `OVER`
- C-04: `5.65 m³/s` vs `6.50 m³/s`, `−13.1%`, `UNDER`

Status uses icon, text, numeric value, and color only as a secondary cue. Add responsible language that residuals may reflect conveyance, storage, uncertainty, or data quality and are not automatically theft/leakage.

Zoom toward A-07. The hotspot must grow into the telemetry inspector rather than hard-cutting.

### 4. Live measurement

Heading: `O‘lchovdan qarorgacha.`

Show:

- Stage `2.18 m`
- Discharge `8.74 m³/s`
- Delivered today `524,310 m³`
- Planned today `491,000 m³`
- Difference `+33,310 m³ (+6.8%)`
- Duration `47 min`
- Confidence `HIGH`
- Last observation `12 sec ago`
- Device `ONLINE`

Include a subtle 24-hour sparkline and quality/signal indicators. Expand and reorganize this inspector into the command-center frame.

### 5. Command center

Heading: `Bir qarashda butun hudud.`

Representative composition only, not the full product. Include:

- inflow `18.4M m³`
- delivered `17.1M m³`
- planned `16.8M m³`
- compliance `92.7%`
- unexplained balance `1.8%`
- critical alarms `7`
- online stations `97.6%`

Also show a stylized regional network/map, ranked deviations, plan-vs-actual-vs-previous chart, system confidence, and period controls `Bugun`, `Hafta`, `Oy`, `Mavsum`, `Yil`.

### 6. Alarm to incident

Heading: `Og‘ish signalga, signal esa vazifaga aylanadi.`

Alert `A-07 allocation deviation`; evidence `+6.8% · +33,310 m³ · 47 min · confidence HIGH`; lifecycle `Created → Acknowledged → Assigned → Investigating → Resolved`. Separate water status from severity. Show responsible team, acknowledgement, timeline, and audit indicator. No flashing red.

### 7. Three operational layers

Heading: `O‘lchovdan davlat darajasidagi operatsiyagacha.`

Show connected planes:

1. Measurement Layer — sensors, stations, edge buffering, quality/provenance.
2. Water Intelligence — validation, stage-to-flow boundary, allocation comparison, balance, alerts/forecasting.
3. Government Operations — command center, incidents, approvals, reports, audit.

Use a calm exploded-layer transition; avoid WebGL for the MVP.

### 8. Final CTA

Headline: `Suv taqsimotini ko‘ring. Qarorni dalil bilan qabul qiling.`

Copy: `iSuv — hududiy suv boshqaruvi uchun jonli monitoring, hisob, ogohlantirish va audit qatlami.`

Buttons: `Interaktiv demoni ko‘rish`, `Platforma imkoniyatlari`.

Note: `MVP preview · synthetic data · no physical infrastructure control`.

## Technical direction

First inspect and preserve any useful stack. If no frontend exists, create the smallest future-compatible structure with Next.js App Router, React, strict TypeScript, GSAP + ScrollTrigger, `@gsap/react`, restrained Lenis smoothing, and original SVG/CSS components. Do not add Three.js, React Three Fiber, Lottie, CMS, backend, database, auth, a map SDK, paid GSAP plugins, or a large UI framework.

Keep content and demo values in typed configuration. Prefer transform and opacity animation, avoid per-frame React state and continuous layout-property animation, and correctly clean up ScrollTrigger/Lenis/RAF resources.

Desktop review target: 1440×900 with the full connected narrative. Mobile review target: 390×844 with simplified native vertical sections, minimal pinning, no forced touch inertia, no overflow, and 44 px touch targets.

## Accessibility and reduced motion

Use semantic landmarks/headings, keyboard-operable controls, visible focus, adequate contrast, meaningful SVG labels, chart text summaries, and status meaning beyond color. Respect `prefers-reduced-motion` in CSS and JavaScript. When reduced motion is active, disable Lenis and long pinning/parallax/large zooms, use short fades or static final states, and keep all information available.

## Required evidence

Add temporary task `D0-001 — Creative smooth-transition landing-page MVP` near the top of `TASKS.md` without completing existing P0–P7 tasks. Update `docs/EXECUTION_LEDGER.md` concisely.

Create:

- `docs/design/LANDING_MVP_SPEC.md`
- `docs/design/LANDING_MVP_REVIEW.md`
- `docs/design/landing-mvp/desktop.png`
- `docs/design/landing-mvp/mobile.png`

Verify install/start, `/`, all chapters, localization, Motion toggle, anchors, reverse scroll, CTA targets, synthetic labels, units, responsive behavior, reduced motion, no horizontal overflow, no console errors, formatting, lint, type checks, tests, production build, and Chromium smoke/screenshots.

Make one coherent commit:

`feat(landing): add approval-gated iSuv motion MVP`

Then keep the preview available, report its exact URL and artifact paths, state that no platform implementation was started, and stop for approval.
