# Blockers and External Dependencies

A blocker should not stop independent implementation. Record it, choose a safe adapter/fixture/assumption where allowed, and continue.

Last reviewed after P3-003 on 2026-08-24: B-001–B-004 remain external rollout dependencies. Rating curves, coverage policies, derived volumes, allocation plans, measurement bindings, tolerance versions, and planned-vs-actual results are therefore synthetic-only and explicitly ineligible for official compliance. Missing plans, intervals, bindings, tolerances, trusted actuals, and zero-plan policy remain visibly unassessable rather than normal. No new blocker prevents synthetic parent-child balance and travel-time work.

| ID | Date | Area | Missing input/decision | Why it blocks | Safe temporary approach | Owner | Status |
|---|---|---|---|---|---|---|---|
| B-001 | Initial | Hydrometry | Official station-specific rating curves/calibration | Real stage-to-discharge accuracy cannot be claimed | Use clearly labeled synthetic versioned curves behind an adapter | Government/hydrologist | Open |
| B-002 | Initial | GIS | Official 83-site geometries and network topology | Real map cannot be authoritative | Seed synthetic geometries/topology and support import | Government/GIS team | Open |
| B-003 | Initial | Devices | Real payloads, protocols, certificates, connectivity | Production ingestion adapters cannot be finalized | Build simulator and adapter interfaces | Hardware/OT team | Open |
| B-004 | Initial | Allocation | Legally approved plans/tolerances/escalation rules | Compliance cannot be official | Use synthetic plans and configurable policies | Water authority | Open |
