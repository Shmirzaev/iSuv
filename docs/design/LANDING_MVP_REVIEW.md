# iSuv Creative Landing MVP — Review Checklist

## What to review

1. Does the hero communicate a serious regional water operations platform rather than a generic dashboard?
2. Does the continuous river → branch → node → dashboard transition feel clear and premium?
3. Is the balance between creative motion and government-grade credibility correct?
4. Are the primary product messages understandable without reading every paragraph?
5. Does the mobile layout preserve the story rather than merely stacking desktop elements?

## Implemented interactions

- Scroll-progress-controlled network drawing.
- Branch reveal and status labels.
- Camera zoom toward A-07.
- Station inspector reveal.
- Inspector-to-dashboard morph.
- Alarm slide-in and acknowledgement state.
- Layered product architecture reveal.
- Interactive command sidebar labels.
- Motion toggle and reduced-motion behavior.
- Dialog overview and keyboard-focus styles.

## Verification commands

```bash
npm test
npm run dev
```

## Approval options

- `APPROVED` — preserve the direction and continue to production implementation.
- `APPROVED WITH CHANGES` — list specific motion, copy, color, or layout changes.
- `REJECTED` — replace the creative direction before continuing.

No full-platform tasks should start from this review document alone.

## Verification evidence

- Node syntax check: passed.
- Smoke tests: **4/4 passed**.
- Chromium browser QA: **30/30 checks passed**.
- Desktop viewport: **1440 × 1000**.
- Mobile viewport: **390 × 844**.
- Verified: no horizontal overflow, all six scroll keyframes, sticky-stage behavior, station inspector, dashboard morph, alarm acknowledgement, overview dialog, command dashboard, mobile layouts, and zero console/page errors.
- Machine-readable results: `docs/design/LANDING_MVP_BROWSER_QA.json`.

Review screenshots are generated locally under `docs/design/landing-mvp/`; the source branch stays text-only because the connected GitHub writer does not support binary image uploads.
