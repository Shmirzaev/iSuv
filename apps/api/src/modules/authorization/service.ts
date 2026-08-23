import type { AuthorizationAction, EffectiveGrant } from '@isuv/domain';
import { decideTerritoryAuthorization } from '@isuv/domain';
import { withDatabase } from '../../db/client.js';

export interface TerritoryAuthorizationRepository {
  findEffectiveGrantsForTarget(
    userId: string,
    targetTerritoryId: string,
    evaluatedAt: Date,
  ): Promise<EffectiveGrant[]>;
}

interface GrantRow {
  id: string;
  role: EffectiveGrant['role'];
  scope: EffectiveGrant['scope'];
  territory_id: string | null;
  covers_target_territory: boolean;
}

export class PostgresTerritoryAuthorizationRepository implements TerritoryAuthorizationRepository {
  public constructor(private readonly databaseUrl: string | undefined) {}

  public async findEffectiveGrantsForTarget(
    userId: string,
    targetTerritoryId: string,
    evaluatedAt: Date,
  ): Promise<EffectiveGrant[]> {
    return withDatabase(this.databaseUrl, async (pool) => {
      const result = await pool.query<GrantRow>(
        `WITH RECURSIVE active_user AS (
           SELECT id
           FROM identity_users
           WHERE id = $1 AND is_active = true
         ),
         target AS (
           SELECT target.id, target.parent_territory_id, target.organization_id
           FROM territories target
           WHERE target.id = $2
         ),
         target_ancestors AS (
           SELECT id, parent_territory_id, ARRAY[id] AS path
           FROM target
           UNION ALL
           SELECT t.id, t.parent_territory_id, ancestor.path || t.id
           FROM territories t
           JOIN target_ancestors ancestor ON ancestor.parent_territory_id = t.id
           WHERE NOT t.id = ANY(ancestor.path)
         )
         SELECT
           g.id,
           g.role,
           g.scope,
           g.territory_id,
           EXISTS (
             SELECT 1 FROM target_ancestors ancestor WHERE ancestor.id = g.territory_id
           ) AS covers_target_territory
         FROM user_role_grants g
         JOIN active_user ON true
         JOIN target ON g.scope = 'system' OR target.organization_id = g.organization_id
         WHERE g.user_id = $1
           AND g.effective_from <= $3
           AND (g.effective_until IS NULL OR g.effective_until > $3)`,
        [userId, targetTerritoryId, evaluatedAt],
      );
      return result.rows.map((grant) => ({
        id: grant.id,
        role: grant.role,
        scope: grant.scope,
        territoryId: grant.territory_id,
        coversTargetTerritory: grant.covers_target_territory,
      }));
    });
  }
}

export async function authorizeTerritoryAction(
  repository: TerritoryAuthorizationRepository,
  userId: string,
  action: AuthorizationAction,
  targetTerritoryId: string,
  evaluatedAt: Date = new Date(),
) {
  const grants = await repository.findEffectiveGrantsForTarget(
    userId,
    targetTerritoryId,
    evaluatedAt,
  );
  return decideTerritoryAuthorization({ action, targetTerritoryId, grants });
}
