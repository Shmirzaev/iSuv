# Regional Water Platform — Codex Operating Contract

## Mission

Build a government-grade regional water operations, accounting, monitoring, and decision-support platform. It must ingest live water telemetry, model the upstream/downstream network, compare approved allocations with actual delivery, identify trustworthy over/under distribution, support alarms and incidents, provide GIS and analytical views, and preserve an auditable history.

Use a normal Codex run. Do not switch to Goal mode.

## Source-of-truth order

1. Explicit instructions from the user in the current thread.
2. `docs/reference/water-platform-research.pdf`.
3. `docs/PRODUCT_CONTEXT.md`.
4. `docs/ACCEPTANCE_CRITERIA.md`.
5. Accepted architecture decision records in `docs/adr/` and `docs/DECISIONS.md`.
6. `TASKS.md`, `docs/EXECUTION_LEDGER.md`, and the current repository state.

When sources conflict, document the conflict in `docs/DECISIONS.md`; do not silently invent policy.

## Mandatory domain invariants

- Water level/stage is measured in metres.
- Instantaneous discharge/flow is measured in m³/s.
- Accumulated delivered volume is measured in m³.
- Never conflate those values in APIs, calculations, UI labels, alerts, or reports.
- Every observation must retain timestamp, unit, sensor/device identity, quality state, provenance, and correction history.
- No-data and unreliable-data states must never look normal.
- Status must not rely on color alone; show text/icon/value as well.
- Allocation plans and threshold changes are versioned, approved, effective-dated, and auditable.
- Version 1 is monitoring and decision support. Do not implement autonomous physical gate/pump/valve control.
- Synthetic/demo data must be clearly labeled and never presented as real government telemetry.

## Orchestration rules

For work spanning more than one subsystem, delegate independent work to subagents. Use the project agents under `.codex/agents/`.

- Spawn read-only specialists in parallel for architecture, hydrology/domain validation, exploration, and review.
- Use implementation agents for bounded tasks with explicit file ownership and acceptance criteria.
- Do not run concurrent write agents against overlapping files. Serialize overlapping work.
- The primary agent owns integration, cross-module contracts, final review, task state, and commits.
- Ask subagents to return concrete file paths, assumptions, tests, and unresolved risks.
- Wait for required subagents before integrating their work.

## Continuous execution loop

Do not stop after producing a plan. Continue into implementation.

1. Read `AGENTS.md`, `docs/PRODUCT_CONTEXT.md`, `docs/ACCEPTANCE_CRITERIA.md`, `TASKS.md`, `docs/DECISIONS.md`, `docs/BLOCKERS.md`, and `docs/EXECUTION_LEDGER.md`.
2. Inspect the repository, Git status, tests, and existing stack.
3. Select the highest-priority unblocked task whose dependencies are complete.
4. State or refine measurable acceptance criteria in `TASKS.md`.
5. Delegate independent analysis or implementation when useful.
6. Implement a complete vertical slice, not disconnected placeholders.
7. Run relevant formatting, type checks, unit tests, integration tests, migrations, and smoke tests.
8. Use a reviewer or QA/security agent for risky or cross-cutting changes.
9. Fix failures before marking the task complete.
10. Update `TASKS.md`, `docs/EXECUTION_LEDGER.md`, `docs/DECISIONS.md`, and `docs/BLOCKERS.md`.
11. Commit a coherent, tested change with a descriptive commit message.
12. Immediately continue with the next unblocked task.

## When to ask the user

Ask only when work requires one of the following and cannot safely proceed with an adapter, fixture, documented assumption, or synthetic data:

- production credentials or secrets;
- a legally authoritative allocation rule or government policy decision;
- real device protocols/payloads that are unavailable;
- official GIS geometry or hydrological calibration/rating curves;
- an irreversible production action, external purchase, or real infrastructure control;
- a choice that materially changes scope, cost, legal obligations, or data ownership.

When blocked, record the blocker and continue on independent work instead of stopping the project.

## Engineering quality bar

- Preserve or improve the existing stack; do not rewrite a working repository without a documented ADR.
- Prefer open, vendor-neutral interfaces and replaceable adapters.
- Use migrations and seed data; never rely on undocumented manual database steps.
- Keep API contracts typed and versioned.
- Add tests for calculations, permissions, alarms, data quality, and critical user flows.
- Use UTC internally and explicit local-time presentation.
- Make units explicit in schemas and UI.
- Build Uzbek, Russian, and English localization capability from the start.
- Target WCAG 2.2 AA behavior.
- Enforce role plus territory scope, least privilege, MFA-ready identity integration, and auditable changes.
- Keep OT/device control isolated behind interfaces; do not expose PLC/RTU control directly to the web application.
- Provide local development through repeatable scripts/containers and a documented `.env.example` without secrets.
- Add observability: structured logs, health checks, metrics, error handling, and trace/correlation IDs where appropriate.

## Completion boundary

The software MVP is complete only when every item marked `MVP REQUIRED` in `docs/ACCEPTANCE_CRITERIA.md` is demonstrably met, the required tests pass, the local stack starts from documented commands, seeded synthetic data demonstrates the core workflows, no critical security findings remain, and the execution ledger contains verification evidence.

Do not claim the full government deployment is complete if real sensors, official plans, calibration data, infrastructure approvals, or production operations are not available. Document those as rollout dependencies.
