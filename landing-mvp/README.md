# iSuv Creative Landing MVP

Approval-stage coded prototype for the iSuv regional water operations platform.

## Run

```bash
cd landing-mvp
npm run dev
```

Open `http://localhost:4173`.

## Verify

```bash
cd landing-mvp
npm test
```

## Included

- Cinematic scroll story: main canal → network split → A-07 zoom → telemetry inspector → command dashboard → alarm workflow → platform layers.
- Responsive desktop and mobile layouts.
- Motion toggle and `prefers-reduced-motion` support.
- Clearly labeled synthetic data.
- Correct distinction between stage (`m`), discharge (`m³/s`), and accumulated volume (`m³`).
- No real infrastructure control.

This branch is a visual and interaction MVP only. It does not begin the complete platform implementation in `TASKS.md`.
