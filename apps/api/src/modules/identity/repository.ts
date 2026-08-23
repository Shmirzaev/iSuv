import type { AuthorizationGrant, IdentityUser, Organization, Session } from '@isuv/contracts';
import { withDatabase } from '../../db/client.js';

export interface IdentitySessionRepository {
  findCurrentSession(userId: string, resolvedAt: Date): Promise<Session | null>;
}

interface SessionRow {
  user_id: string;
  user_organization_id: string;
  external_subject: string;
  display_name: string;
  is_active: boolean;
  user_data_classification: 'synthetic' | 'official';
  organization_id: string;
  organization_code: string;
  organization_name: string;
  organization_data_classification: 'synthetic' | 'official';
}

interface GrantRow {
  id: string;
  user_id: string;
  organization_id: string;
  role: AuthorizationGrant['role'];
  scope: AuthorizationGrant['scope'];
  territory_id: string | null;
  effective_from: Date;
  effective_until: Date | null;
  cancelled_at: Date | null;
}

function isoUtc(value: Date): string {
  return value.toISOString();
}

export class PostgresIdentitySessionRepository implements IdentitySessionRepository {
  public constructor(private readonly databaseUrl: string | undefined) {}

  public async findCurrentSession(userId: string, resolvedAt: Date): Promise<Session | null> {
    return withDatabase(this.databaseUrl, async (pool) => {
      const userResult = await pool.query<SessionRow>(
        `SELECT
           u.id AS user_id,
           u.organization_id AS user_organization_id,
           u.external_subject,
           u.display_name,
           u.is_active,
           u.data_classification AS user_data_classification,
           o.id AS organization_id,
           o.code AS organization_code,
           o.name AS organization_name,
           o.data_classification AS organization_data_classification
         FROM identity_users u
         JOIN organizations o ON o.id = u.organization_id
         WHERE u.id = $1 AND u.is_active = true`,
        [userId],
      );
      const userRow = userResult.rows[0];
      if (!userRow) return null;

      const grantResult = await pool.query<GrantRow>(
        `SELECT id, user_id, organization_id, role, scope, territory_id, effective_from, effective_until, cancelled_at
         FROM user_role_grants
         WHERE user_id = $1
           AND cancelled_at IS NULL
           AND effective_from <= $2
           AND (effective_until IS NULL OR effective_until > $2)
         ORDER BY effective_from, id`,
        [userId, resolvedAt],
      );

      const user: IdentityUser = {
        id: userRow.user_id,
        organizationId: userRow.user_organization_id,
        externalSubject: userRow.external_subject,
        displayName: userRow.display_name,
        isActive: userRow.is_active,
        dataClassification: userRow.user_data_classification,
      };
      const organization: Organization = {
        id: userRow.organization_id,
        code: userRow.organization_code,
        name: userRow.organization_name,
        dataClassification: userRow.organization_data_classification,
      };
      const currentGrants: AuthorizationGrant[] = grantResult.rows.map((grant) => ({
        id: grant.id,
        userId: grant.user_id,
        organizationId: grant.organization_id,
        role: grant.role,
        scope: grant.scope,
        territoryId: grant.territory_id,
        effectiveFrom: isoUtc(grant.effective_from),
        effectiveUntil: grant.effective_until ? isoUtc(grant.effective_until) : null,
        cancelledAt: grant.cancelled_at ? isoUtc(grant.cancelled_at) : null,
      }));
      return { user, organization, currentGrants, resolvedAt: isoUtc(resolvedAt) };
    });
  }
}
