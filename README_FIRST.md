# Water Platform Codex Bootstrap Pack

This pack turns the repository into a persistent, resumable Codex project. It is designed for a normal Codex chat with subagents; it does **not** require Goal mode.

## Use it

1. Copy everything from this folder into the root of your project repository.
2. Keep the included research PDF at `docs/reference/water-platform-research.pdf`.
3. Make sure the project is a Git repository and create a clean baseline commit before Codex starts editing.
4. Open the repository in the ChatGPT desktop app, select **Codex**, and start a normal chat.
5. Select a permission mode that allows workspace edits but does not grant unrestricted machine access. Do not expose production secrets.
6. Use `gpt-5.6` for the lead thread. The project config uses `gpt-5.6-terra` for most supporting agents to reduce latency.
7. Paste the complete contents of `MASTER_PROMPT.md` once.

Codex should then read the persistent context, inspect the existing repository, build a task graph, delegate independent work to subagents, implement the next unblocked vertical slices, run tests, and keep a resumable execution record.

## When a run ends before the MVP is complete

Paste the single sentence in `CONTINUE_PROMPT.md`. You should not need to restate the product context.

## Important boundary

“Done” in this pack means a production-like **software MVP/pilot** with simulated telemetry and documented integration boundaries. Real hydrological calibration, official GIS geometry, device credentials, legal allocation rules, production deployment, and remote control of physical gates require approved external data and authorized humans.
