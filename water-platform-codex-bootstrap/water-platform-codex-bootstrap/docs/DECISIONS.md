# Decision Log

Record only decisions that affect architecture, scope, policy, data meaning, security, or acceptance.

| ID | Date | Decision | Reason | Alternatives considered | Consequences | Status |
|---|---|---|---|---|---|---|
| D-001 | Initial | Version 1 is monitoring/decision support with synthetic telemetry; no physical control. | Safety and unavailable authorized OT inputs. | Direct control in MVP. | Control interfaces remain read-only/adapted. | Accepted |
| D-002 | Initial | Stage (m), discharge (m³/s), and volume (m³) are distinct domain quantities. | Required for correct hydrometry and reporting. | Generic `water_value`. | Schemas and UI must carry explicit type/unit. | Accepted |

Add new rows and create an ADR in `docs/adr/` for decisions with meaningful technical trade-offs.
