export const auditClassifications = ['synthetic', 'official'] as const;
export type AuditClassification = (typeof auditClassifications)[number];

/**
 * Keep this resource vocabulary aligned with the public audit contract and
 * database enum. The exhaustive action vocabulary is canonical in
 * `@isuv/contracts`; this lower-level package deliberately keeps `action` a
 * string to avoid a domain -> contracts dependency cycle.
 */
export const auditResources = [
  'user_role_grant',
  'observation',
  'validation_profile',
  'allocation_plan',
  'quantity_model',
  'tolerance_policy',
  'water_balance_model',
  'alarm_rule',
  'alarm_catalog',
  'alarm',
  'incident',
  'escalation_policy',
  'maintenance_record',
  'report',
] as const;
export type AuditResource = (typeof auditResources)[number];

export interface AuditEvent {
  id: string;
  organizationId: string;
  territoryId: string;
  actorUserId: string;
  actorOrganizationId: string;
  action: string;
  resource: AuditResource;
  resourceId: string;
  oldState: Record<string, unknown> | null;
  newState: Record<string, unknown> | null;
  reason: string;
  requestId: string;
  occurredAt: string;
  dataClassification: AuditClassification;
  provenance: string;
}

/** Lower ranked roles may be administered only by a strictly higher role. */
export const administrativeRoleRank = {
  auditor: 10,
  hydrologist: 20,
  maintenance_engineer: 20,
  district_operator: 30,
  basin_dispatcher: 40,
  regional_director: 50,
  national_admin: 60,
  system_admin: 70,
} as const;

export function mayAdministerRole(
  actorRole: keyof typeof administrativeRoleRank,
  targetRole: keyof typeof administrativeRoleRank,
): boolean {
  return administrativeRoleRank[actorRole] > administrativeRoleRank[targetRole];
}
