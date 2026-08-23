import type {
  AuthorizationGrant,
  CreateRoleGrantRequest,
  RevokeRoleGrantRequest,
  RoleGrantMutationResponse,
  UserRole,
} from '@isuv/contracts';
import {
  administrativeRoleRank,
  decideTerritoryAuthorization,
  mayAdministerRole,
  type EffectiveGrant,
  type UserRole as DomainUserRole,
} from '@isuv/domain';
import type { PoolClient } from 'pg';
import { withDatabase } from '../../db/client.js';

type AdministrationFailure = 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION_ERROR' | 'CONFLICT';

export class AdministrationError extends Error {
  public constructor(
    public readonly kind: AdministrationFailure,
    message: string,
  ) {
    super(message);
  }
}

interface GrantRow {
  id: string;
  user_id: string;
  organization_id: string;
  role: UserRole;
  scope: AuthorizationGrant['scope'];
  territory_id: string | null;
  effective_from: Date;
  effective_until: Date | null;
  cancelled_at: Date | null;
}

interface TargetRow {
  id: string;
  organization_id: string;
  data_classification: 'synthetic' | 'official';
}

interface TerritoryRow {
  id: string;
  organization_id: string;
}

function toGrant(row: GrantRow): AuthorizationGrant {
  return {
    id: row.id,
    userId: row.user_id,
    organizationId: row.organization_id,
    role: row.role,
    scope: row.scope,
    territoryId: row.territory_id,
    effectiveFrom: row.effective_from.toISOString(),
    effectiveUntil: row.effective_until?.toISOString() ?? null,
    cancelledAt: row.cancelled_at?.toISOString() ?? null,
  };
}

async function findActiveTarget(client: PoolClient, userId: string): Promise<TargetRow> {
  const result = await client.query<TargetRow>(
    `SELECT id, organization_id, data_classification
     FROM identity_users
     WHERE id = $1 AND is_active = true`,
    [userId],
  );
  const target = result.rows[0];
  if (!target) throw new AdministrationError('NOT_FOUND', 'The requested user was not found.');
  return target;
}

async function findActiveActor(client: PoolClient, userId: string): Promise<TargetRow> {
  const result = await client.query<TargetRow>(
    `SELECT id, organization_id, data_classification
     FROM identity_users
     WHERE id = $1 AND is_active = true`,
    [userId],
  );
  const actor = result.rows[0];
  if (!actor)
    throw new AdministrationError('FORBIDDEN', 'You are not authorized to administer permissions.');
  return actor;
}

async function findAnchorTerritory(
  client: PoolClient,
  organizationId: string,
): Promise<TerritoryRow> {
  const result = await client.query<TerritoryRow>(
    `SELECT id, organization_id
     FROM territories
     WHERE organization_id = $1
     ORDER BY (parent_territory_id IS NULL) DESC, code, id
     LIMIT 1`,
    [organizationId],
  );
  const territory = result.rows[0];
  if (!territory) {
    throw new AdministrationError('VALIDATION_ERROR', 'The target organization has no territory.');
  }
  return territory;
}

async function findTerritory(
  client: PoolClient,
  territoryId: string,
  organizationId: string,
): Promise<TerritoryRow> {
  const result = await client.query<TerritoryRow>(
    `SELECT id, organization_id FROM territories WHERE id = $1 AND organization_id = $2`,
    [territoryId, organizationId],
  );
  const territory = result.rows[0];
  if (!territory) {
    throw new AdministrationError('NOT_FOUND', 'The requested territory was not found.');
  }
  return territory;
}

async function findActorGrantsForTarget(
  client: PoolClient,
  actorUserId: string,
  targetTerritoryId: string,
  evaluatedAt: Date,
): Promise<EffectiveGrant[]> {
  const result = await client.query<{
    id: string;
    role: DomainUserRole;
    scope: EffectiveGrant['scope'];
    territory_id: string | null;
    covers_target_territory: boolean;
  }>(
    `WITH RECURSIVE active_user AS (
       SELECT id FROM identity_users WHERE id = $1 AND is_active = true
     ), target AS (
       SELECT id, parent_territory_id, organization_id FROM territories WHERE id = $2
     ), ancestors AS (
       SELECT id, parent_territory_id, ARRAY[id] AS path FROM target
       UNION ALL
       SELECT territory.id, territory.parent_territory_id, ancestors.path || territory.id
       FROM territories territory
       JOIN ancestors ON ancestors.parent_territory_id = territory.id
       WHERE NOT territory.id = ANY(ancestors.path)
     )
     SELECT g.id, g.role, g.scope, g.territory_id,
       EXISTS (SELECT 1 FROM ancestors WHERE id = g.territory_id) AS covers_target_territory
     FROM user_role_grants g
     JOIN active_user ON true
     JOIN target ON g.scope = 'system' OR target.organization_id = g.organization_id
     WHERE g.user_id = $1
       AND g.cancelled_at IS NULL
       AND g.effective_from <= $3
       AND (g.effective_until IS NULL OR g.effective_until > $3)`,
    [actorUserId, targetTerritoryId, evaluatedAt],
  );
  return result.rows.map((row) => ({
    id: row.id,
    role: row.role,
    scope: row.scope,
    territoryId: row.territory_id,
    coversTargetTerritory: row.covers_target_territory,
  }));
}

async function requireGrantAuthority(
  client: PoolClient,
  actorUserId: string,
  targetTerritoryId: string,
  targetRole: UserRole,
  evaluatedAt: Date,
): Promise<void> {
  const grants = await findActorGrantsForTarget(
    client,
    actorUserId,
    targetTerritoryId,
    evaluatedAt,
  );
  const permissionDecision = decideTerritoryAuthorization({
    action: 'permission:write',
    targetTerritoryId,
    grants,
  });
  if (!permissionDecision.allowed) {
    if (
      permissionDecision.reason === 'ROLE_READ_ONLY' ||
      permissionDecision.reason === 'ROLE_NOT_PERMITTED'
    ) {
      throw new AdministrationError(
        'FORBIDDEN',
        'You cannot administer permissions with this role.',
      );
    }
    throw new AdministrationError('FORBIDDEN', 'You are not authorized to administer permissions.');
  }

  const canAdminister = grants.some((grant) => {
    const role = grant.role as keyof typeof administrativeRoleRank;
    const target = targetRole as keyof typeof administrativeRoleRank;
    const covers =
      grant.scope === 'system' || grant.scope === 'national' || grant.coversTargetTerritory;
    return covers && mayAdministerRole(role, target);
  });
  if (!canAdminister) {
    throw new AdministrationError('FORBIDDEN', 'You cannot grant or revoke this role.');
  }
}

async function writeAuditEvent(
  client: PoolClient,
  input: {
    organizationId: string;
    territoryId: string;
    actorUserId: string;
    actorOrganizationId: string;
    action: RoleGrantMutationResponse['auditEvent']['action'];
    resourceId: string;
    oldState: AuthorizationGrant | null;
    newState: AuthorizationGrant | null;
    reason: string;
    requestId: string;
    dataClassification: 'synthetic' | 'official';
  },
): Promise<RoleGrantMutationResponse['auditEvent']> {
  const result = await client.query<{
    id: string;
    organization_id: string;
    territory_id: string;
    actor_user_id: string;
    actor_organization_id: string;
    action: RoleGrantMutationResponse['auditEvent']['action'];
    resource: 'user_role_grant';
    resource_id: string;
    old_state: Record<string, unknown> | null;
    new_state: Record<string, unknown> | null;
    reason: string;
    request_id: string;
    occurred_at: Date;
    data_classification: 'synthetic' | 'official';
    provenance: string;
  }>(
    `INSERT INTO audit_events (
       organization_id, territory_id, actor_user_id, actor_organization_id, action, resource, resource_id,
       old_state, new_state, reason, request_id, data_classification, provenance
     ) VALUES ($1, $2, $3, $4, $5, 'user_role_grant', $6, $7::jsonb, $8::jsonb, $9, $10, $11, 'administration_api')
     RETURNING *`,
    [
      input.organizationId,
      input.territoryId,
      input.actorUserId,
      input.actorOrganizationId,
      input.action,
      input.resourceId,
      input.oldState === null ? null : JSON.stringify(input.oldState),
      input.newState === null ? null : JSON.stringify(input.newState),
      input.reason,
      input.requestId,
      input.dataClassification,
    ],
  );
  const row = result.rows[0]!;
  return {
    id: row.id,
    organizationId: row.organization_id,
    territoryId: row.territory_id,
    actorUserId: row.actor_user_id,
    actorOrganizationId: row.actor_organization_id,
    action: row.action,
    resource: row.resource,
    resourceId: row.resource_id,
    oldState: row.old_state,
    newState: row.new_state,
    reason: row.reason,
    requestId: row.request_id,
    occurredAt: row.occurred_at.toISOString(),
    dataClassification: row.data_classification,
    provenance: row.provenance,
  };
}

export class PostgresRoleGrantAdministrationService {
  public constructor(
    private readonly databaseUrl: string | undefined,
    private readonly transactionClient?: PoolClient,
  ) {}

  private async transaction<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    if (this.transactionClient) {
      // An injected client is used only by integration tests that wrap their
      // fixtures in one outer transaction.  A savepoint preserves rollback
      // semantics after an expected constraint failure without committing any
      // test-owned records.
      await this.transactionClient.query('SAVEPOINT administration_operation');
      try {
        const result = await action(this.transactionClient);
        await this.transactionClient.query('RELEASE SAVEPOINT administration_operation');
        return result;
      } catch (error) {
        await this.transactionClient.query('ROLLBACK TO SAVEPOINT administration_operation');
        await this.transactionClient.query('RELEASE SAVEPOINT administration_operation');
        throw error;
      }
    }
    return withDatabase(this.databaseUrl, async (pool) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await action(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    });
  }

  public async create(
    actorUserId: string,
    requestId: string,
    input: CreateRoleGrantRequest,
    occurredAt: Date = new Date(),
  ): Promise<RoleGrantMutationResponse> {
    if (actorUserId === input.userId) {
      throw new AdministrationError('FORBIDDEN', 'Users cannot grant themselves a role.');
    }
    try {
      return await this.transaction(async (client) => {
        const actor = await findActiveActor(client, actorUserId);
        const target = await findActiveTarget(client, input.userId);
        const territory = input.territoryId
          ? await findTerritory(client, input.territoryId, target.organization_id)
          : await findAnchorTerritory(client, target.organization_id);
        try {
          await requireGrantAuthority(client, actorUserId, territory.id, input.role, occurredAt);
        } catch (error) {
          // An actor outside the target territory must not be able to use a
          // creation request as a directory for active users or territories.
          if (
            error instanceof AdministrationError &&
            error.kind === 'FORBIDDEN' &&
            error.message === 'You are not authorized to administer permissions.'
          ) {
            throw new AdministrationError('NOT_FOUND', 'The requested user was not found.');
          }
          throw error;
        }
        const inserted = await client.query<GrantRow>(
          `INSERT INTO user_role_grants
             (user_id, organization_id, role, scope, territory_id, effective_from, effective_until)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, user_id, organization_id, role, scope, territory_id, effective_from, effective_until, cancelled_at`,
          [
            target.id,
            target.organization_id,
            input.role,
            input.scope,
            input.territoryId,
            input.effectiveFrom,
            input.effectiveUntil ?? null,
          ],
        );
        const grant = toGrant(inserted.rows[0]!);
        const auditEvent = await writeAuditEvent(client, {
          organizationId: target.organization_id,
          territoryId: territory.id,
          actorUserId,
          actorOrganizationId: actor.organization_id,
          action: 'user_role_grant.created',
          resourceId: grant.id,
          oldState: null,
          newState: grant,
          reason: input.reason,
          requestId,
          dataClassification: target.data_classification,
        });
        return { grant, auditEvent };
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23P01') {
        throw new AdministrationError(
          'CONFLICT',
          'The requested grant overlaps an existing grant.',
        );
      }
      if ((error as { code?: string }).code === '23514') {
        throw new AdministrationError('VALIDATION_ERROR', 'The requested grant is invalid.');
      }
      throw error;
    }
  }

  public async revoke(
    actorUserId: string,
    requestId: string,
    grantId: string,
    input: RevokeRoleGrantRequest,
    occurredAt: Date = new Date(),
  ): Promise<RoleGrantMutationResponse> {
    return this.transaction(async (client) => {
      const actor = await findActiveActor(client, actorUserId);
      const existingResult = await client.query<GrantRow & TargetRow>(
        `SELECT g.id, g.user_id, g.organization_id, g.role, g.scope, g.territory_id,
                  g.effective_from, g.effective_until, g.cancelled_at, u.data_classification
           FROM user_role_grants g
           JOIN identity_users u ON u.id = g.user_id
           WHERE g.id = $1 AND g.cancelled_at IS NULL AND u.is_active = true
           FOR UPDATE`,
        [grantId],
      );
      const existing = existingResult.rows[0];
      if (!existing)
        throw new AdministrationError('NOT_FOUND', 'The requested grant was not found.');
      const priorRevocation = await client.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM audit_events
           WHERE resource_id = $1 AND action = 'user_role_grant.revoked'
         ) AS exists`,
        [grantId],
      );
      if (priorRevocation.rows[0]?.exists) {
        throw new AdministrationError('NOT_FOUND', 'The requested grant was not found.');
      }
      if (actorUserId === existing.user_id) {
        throw new AdministrationError('FORBIDDEN', 'Users cannot revoke their own role.');
      }
      const territory = existing.territory_id
        ? await findTerritory(client, existing.territory_id, existing.organization_id)
        : await findAnchorTerritory(client, existing.organization_id);
      try {
        await requireGrantAuthority(client, actorUserId, territory.id, existing.role, occurredAt);
      } catch (error) {
        // Do not reveal that a grant exists outside the caller's territory.
        if (
          error instanceof AdministrationError &&
          error.kind === 'FORBIDDEN' &&
          error.message === 'You are not authorized to administer permissions.'
        ) {
          throw new AdministrationError('NOT_FOUND', 'The requested grant was not found.');
        }
        throw error;
      }
      const oldState = toGrant(existing);
      let changed;
      let action: RoleGrantMutationResponse['auditEvent']['action'];
      if (input.operation === 'cancel') {
        action = 'user_role_grant.cancelled';
        changed = await client.query<GrantRow>(
          `UPDATE user_role_grants
           SET cancelled_at = now(), updated_at = now()
           WHERE id = $1
             AND cancelled_at IS NULL
             AND now() < effective_from
           RETURNING id, user_id, organization_id, role, scope, territory_id, effective_from, effective_until, cancelled_at`,
          [grantId],
        );
        if (!changed.rows[0]) {
          throw new AdministrationError(
            'VALIDATION_ERROR',
            'Only a not-yet-effective grant can be cancelled.',
          );
        }
      } else {
        const effectiveUntil = new Date(input.effectiveUntil);
        if (
          occurredAt < existing.effective_from ||
          effectiveUntil < occurredAt ||
          effectiveUntil <= existing.effective_from
        ) {
          throw new AdministrationError('VALIDATION_ERROR', 'The revocation time is invalid.');
        }
        if (existing.effective_until && effectiveUntil > existing.effective_until) {
          throw new AdministrationError('VALIDATION_ERROR', 'A revocation cannot extend a grant.');
        }
        action = 'user_role_grant.revoked';
        changed = await client.query<GrantRow>(
          `UPDATE user_role_grants
           SET effective_until = $2, updated_at = now()
           WHERE id = $1
           RETURNING id, user_id, organization_id, role, scope, territory_id, effective_from, effective_until, cancelled_at`,
          [grantId, input.effectiveUntil],
        );
      }
      const grant = toGrant(changed.rows[0]!);
      const auditEvent = await writeAuditEvent(client, {
        organizationId: existing.organization_id,
        territoryId: territory.id,
        actorUserId,
        actorOrganizationId: actor.organization_id,
        action,
        resourceId: grant.id,
        oldState,
        newState: grant,
        reason: input.reason,
        requestId,
        dataClassification: existing.data_classification,
      });
      return { grant, auditEvent };
    });
  }
}
