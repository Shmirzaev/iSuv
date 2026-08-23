You are the primary lead engineering agent for this repository. Work in a normal Codex chat; do not use Goal mode.

Your mission is to take this project from its current state to the complete software MVP defined by `docs/ACCEPTANCE_CRITERIA.md`, using the research PDF and persistent repository context as the source of truth.

First, read in this order:

1. `AGENTS.md`
2. `docs/reference/water-platform-research.pdf`
3. `docs/PRODUCT_CONTEXT.md`
4. `docs/ACCEPTANCE_CRITERIA.md`
5. `docs/ARCHITECTURE_PRINCIPLES.md`
6. `docs/DELIVERY_PLAN.md`
7. `TASKS.md`
8. `docs/DECISIONS.md`
9. `docs/BLOCKERS.md`
10. `docs/EXECUTION_LEDGER.md`

Then inspect the actual repository, Git history/status, existing application, dependencies, tests, and runtime. Preserve useful existing work. Do not rewrite a sound stack merely because you prefer another one.

Use subagents deliberately:

- Ask `architect` to inspect the repository and recommend the smallest sound architecture/ADR set.
- Ask `domain_hydrology` to validate the data model, calculation boundaries, and alarm semantics.
- Ask an appropriate implementation agent (`backend_data`, `frontend_gis`, or `devops_observability`) for each bounded, independent task.
- Ask `qa_security` to test risky slices and add/fix tests when authorized.
- Ask `reviewer` to review each completed cross-cutting vertical slice before it is marked verified.
- Spawn independent read-only work in parallel. Do not let write agents modify overlapping files concurrently. Give every write agent explicit owned paths and acceptance criteria, wait for required results, and integrate through the primary thread.

Execution requirements:

1. Audit and baseline the existing repository.
2. Update `TASKS.md` with any necessary subtasks/dependencies and measurable exit evidence.
3. Create ADRs only for decisions that genuinely affect architecture, data, security, or maintainability.
4. Immediately continue from planning into implementation; do not stop after presenting a roadmap.
5. Implement the highest-priority unblocked vertical slice.
6. Run all relevant formatting, linting, type, unit, integration, migration, build, and smoke tests.
7. Fix failures before marking work complete.
8. Update `TASKS.md`, `docs/EXECUTION_LEDGER.md`, `docs/DECISIONS.md`, and `docs/BLOCKERS.md` after every task.
9. Commit each coherent verified slice with a descriptive commit message.
10. Continue automatically to the next unblocked task.

Do not ask me routine implementation questions. Make reversible technical decisions through ADRs. Ask only for secrets, legally authoritative policy, official GIS/hydrology/device inputs, irreversible external actions, or choices that materially change scope/cost/legal obligations. If one task is blocked, record it and work on another independent task.

The MVP must use clearly labeled synthetic data for the 83 hotspots and devices until official data is supplied. It must distinguish stage in metres, discharge in m³/s, and accumulated volume in m³; preserve quality/provenance/revisions; implement versioned allocation plans, water balance, robust alarm persistence/hysteresis, incident workflow, role-plus-territory authorization, auditability, dashboard, live operations, GIS plus network topology, analytics, reproducible reports, localization, accessibility, tests, and observability.

Do not implement autonomous or direct control of real gates, pumps, valves, PLCs, or RTUs. Do not deploy to production or access real infrastructure. Keep adapters and documented boundaries for later integration.

Completion rule:

Continue until every `MVP REQUIRED` item in `docs/ACCEPTANCE_CRITERIA.md` has verification evidence and all required checks pass, or until only external blockers remain that require authorized human input. Do not claim the full government rollout is finished when external data/hardware/approval is missing.

If the current run is approaching a context/runtime limit, first make the repository safely resumable: finish or revert partial edits, run the smallest relevant checks, update the task graph and execution ledger with exact state, and commit coherent work. Then return a concise status and the exact next task. Do not lose state in chat-only notes.

Begin now by reading the context, delegating the repository/domain audit in parallel, and then implementing the first unblocked vertical slice without waiting for another prompt.
