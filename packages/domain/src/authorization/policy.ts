export const userRoles = [
  'system_admin',
  'national_admin',
  'regional_director',
  'basin_dispatcher',
  'district_operator',
  'hydrologist',
  'maintenance_engineer',
  'auditor',
] as const;
export type UserRole = (typeof userRoles)[number];

export const grantScopes = ['system', 'national', 'territory'] as const;
export type GrantScope = (typeof grantScopes)[number];

export const territoryResources = [
  'telemetry',
  'allocation_plan',
  'water_balance',
  'alarm',
  'incident',
  'device',
  'report',
  'territory',
  'network',
  'permission',
  'audit',
  'validation_profile',
] as const;
export type TerritoryResource = (typeof territoryResources)[number];
export type AuthorizationAction =
  | `${TerritoryResource}:${'read' | 'write'}`
  | 'telemetry:correct'
  | 'validation_profile:approve'
  | 'allocation_plan:approve'
  | 'water_balance:approve';

export interface EffectiveGrant {
  id: string;
  role: UserRole;
  scope: GrantScope;
  territoryId: string | null;
  /** Present only for territory-scoped grants after hierarchy resolution. */
  coversTargetTerritory: boolean;
}

export interface TerritoryAuthorizationRequest {
  action: AuthorizationAction;
  targetTerritoryId: string;
  grants: readonly EffectiveGrant[];
}

export type AuthorizationDecision =
  | { allowed: true; grantId: string; role: UserRole }
  | {
      allowed: false;
      reason:
        'NO_EFFECTIVE_GRANT' | 'OUTSIDE_TERRITORY_SCOPE' | 'ROLE_READ_ONLY' | 'ROLE_NOT_PERMITTED';
    };

const rolePermissions: Readonly<
  Record<UserRole, readonly AuthorizationAction[] | 'all' | 'read_all'>
> = {
  system_admin: 'all',
  national_admin: 'all',
  regional_director: 'all',
  basin_dispatcher: [
    'network:read',
    'telemetry:read',
    'telemetry:write',
    'alarm:read',
    'alarm:write',
    'incident:read',
    'incident:write',
    'water_balance:read',
    'report:read',
    'validation_profile:read',
  ],
  district_operator: [
    'network:read',
    'telemetry:read',
    'telemetry:write',
    'alarm:read',
    'alarm:write',
    'incident:read',
    'incident:write',
    'water_balance:read',
  ],
  hydrologist: [
    'network:read',
    'telemetry:read',
    'telemetry:write',
    'telemetry:correct',
    'allocation_plan:read',
    'water_balance:read',
    'water_balance:write',
    'report:read',
    'validation_profile:read',
    'validation_profile:write',
    'validation_profile:approve',
    'allocation_plan:approve',
    'water_balance:approve',
  ],
  maintenance_engineer: [
    'network:read',
    'telemetry:read',
    'device:read',
    'device:write',
    'alarm:read',
    'incident:read',
    'incident:write',
  ],
  // Auditors retain their existing read-only authority, including the newly
  // introduced audit resource, but never receive a write capability.
  auditor: 'read_all',
};

function permits(role: UserRole, action: AuthorizationAction): boolean {
  const permissions = rolePermissions[role];
  if (permissions === 'all') return true;
  if (permissions === 'read_all') return action.endsWith(':read');
  return permissions.includes(action);
}

/**
 * Scope is part of a grant's authority, not an optional hint.  Keeping this
 * check in the policy layer means a malformed adapter response cannot turn a
 * lower-tier role into national or system authority.
 */
function hasValidScopeForRole(grant: EffectiveGrant): boolean {
  if (grant.role === 'system_admin') return grant.scope === 'system' && grant.territoryId === null;
  if (grant.role === 'national_admin')
    return grant.scope === 'national' && grant.territoryId === null;
  return grant.scope === 'territory' && grant.territoryId !== null;
}

export function decideTerritoryAuthorization(
  request: TerritoryAuthorizationRequest,
): AuthorizationDecision {
  let sawScopedGrant = false;
  let sawReadOnlyGrant = false;
  let sawRoleGrant = false;

  for (const grant of request.grants) {
    if (!hasValidScopeForRole(grant)) continue;
    const coversTarget =
      grant.scope === 'system' || grant.scope === 'national' || grant.coversTargetTerritory;
    if (!coversTarget) continue;
    sawScopedGrant = true;
    if (!permits(grant.role, request.action)) {
      if (grant.role === 'auditor' && request.action.endsWith(':write')) sawReadOnlyGrant = true;
      else sawRoleGrant = true;
      continue;
    }
    return { allowed: true, grantId: grant.id, role: grant.role };
  }

  if (request.grants.length === 0) return { allowed: false, reason: 'NO_EFFECTIVE_GRANT' };
  if (!sawScopedGrant) return { allowed: false, reason: 'OUTSIDE_TERRITORY_SCOPE' };
  if (sawReadOnlyGrant) return { allowed: false, reason: 'ROLE_READ_ONLY' };
  if (sawRoleGrant) return { allowed: false, reason: 'ROLE_NOT_PERMITTED' };
  return { allowed: false, reason: 'NO_EFFECTIVE_GRANT' };
}
