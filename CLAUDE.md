# iSuv — Claude Code Project Instructions

## Current user objective

Build only the approval-gated creative smooth-transition landing-page MVP described in `docs/design/LANDING_MVP_TASK.md`.

This current instruction has priority over the repository's normal autonomous full-MVP execution loop. Do not begin backend, database, authentication, telemetry ingestion, GIS product implementation, dashboards, or any P0–P7 platform task after the landing MVP is finished.

## Read before editing

Read these files in order:

1. `CLAUDE.md`
2. `AGENTS.md`
3. `docs/design/LANDING_MVP_TASK.md`
4. `docs/PRODUCT_CONTEXT.md`
5. `docs/ACCEPTANCE_CRITERIA.md`
6. `docs/ARCHITECTURE_PRINCIPLES.md`
7. `docs/DECISIONS.md`
8. `docs/BLOCKERS.md`
9. `docs/EXECUTION_LEDGER.md`
10. `TASKS.md`

Then inspect the actual repository, Git status, dependencies, tests, and runtime. Preserve useful existing work and never overwrite unrelated local changes.

## Working boundary

- Work on branch `feat/creative-landing-mvp`.
- Implement the landing page as a complete coded MVP, not a static mockup.
- Use clearly labeled synthetic data only.
- Keep stage in metres, discharge in m³/s, and accumulated volume in m³ distinct everywhere.
- Never imply direct or autonomous control of real gates, pumps, valves, PLCs, or RTUs.
- Keep status understandable through text, icon, and value; color is secondary.
- Support UZ, RU, and EN.
- Implement reduced-motion behavior and a visible Motion On/Off control.
- Use original SVG/CSS visuals; do not copy reference sites or use unlicensed assets.
- Do not deploy, merge to `main`, or push unrelated changes without explicit user approval.

## Execution approach

Proceed without routine questions. Make reversible implementation decisions yourself and document material decisions. Use specialist subagents when available, but the primary Claude Code session owns integration, verification, and the final commit.

Create or update:

- `docs/design/LANDING_MVP_SPEC.md`
- `docs/design/LANDING_MVP_REVIEW.md`
- `docs/design/landing-mvp/desktop.png`
- `docs/design/landing-mvp/mobile.png`
- the temporary `D0-001` task in `TASKS.md`
- concise evidence in `docs/EXECUTION_LEDGER.md`

Run formatting, lint, type checks, tests, production build, browser smoke checks, reduced-motion checks, console-error checks, and responsive screenshots. Fix failures before reporting completion.

## Approval gate

After the MVP is working, tested, documented, screenshotted, and committed:

1. start or keep the local preview running;
2. provide the exact preview URL and review-file paths;
3. summarize the key design decisions and known limitations;
4. explicitly confirm that no platform implementation was started;
5. stop completely and wait for the user to say `APPROVED` or request revisions.

Silence is not approval. Do not continue into the main platform until explicit approval is received.
