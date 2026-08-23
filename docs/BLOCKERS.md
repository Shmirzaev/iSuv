# Blockers and External Dependencies

A blocker should not stop independent implementation. Record it, choose a safe adapter/fixture/assumption where allowed, and continue.

Last reviewed after P2-003 on 2026-08-24: B-001–B-004 remain external rollout dependencies. The validation engine accepts only governed effective profiles and ships no official station bounds, cadence/freshness policy, calibration, reset/rollover rule, rating curve, or production device payload; synthetic bounded bootstrap remains visibly non-authoritative.

| ID | Date | Area | Missing input/decision | Why it blocks | Safe temporary approach | Owner | Status |
|---|---|---|---|---|---|---|---|
| B-001 | Initial | Hydrometry | Official station-specific rating curves/calibration | Real stage-to-discharge accuracy cannot be claimed | Use clearly labeled synthetic versioned curves behind an adapter | Government/hydrologist | Open |
| B-002 | Initial | GIS | Official 83-site geometries and network topology | Real map cannot be authoritative | Seed synthetic geometries/topology and support import | Government/GIS team | Open |
| B-003 | Initial | Devices | Real payloads, protocols, certificates, connectivity | Production ingestion adapters cannot be finalized | Build simulator and adapter interfaces | Hardware/OT team | Open |
| B-004 | Initial | Allocation | Legally approved plans/tolerances/escalation rules | Compliance cannot be official | Use synthetic plans and configurable policies | Water authority | Open |
