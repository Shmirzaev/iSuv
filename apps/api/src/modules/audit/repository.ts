import type { AuditEvent, AuditEventSummary, ListAuditEventsQuery } from '@isuv/contracts';
import type { PoolClient } from 'pg';
import { withDatabase } from '../../db/client.js';

interface AuditRow {
  id: string;
  organization_id: string;
  territory_id: string;
  actor_user_id: string;
  actor_organization_id: string;
  action: AuditEvent['action'];
  resource: AuditEvent['resource'];
  resource_id: string;
  old_state: Record<string, unknown> | null;
  new_state: Record<string, unknown> | null;
  reason: string;
  request_id: string;
  occurred_at: Date;
  data_classification: AuditEvent['dataClassification'];
  provenance: string;
}

type AuditSummaryRow = Omit<AuditRow, 'old_state' | 'new_state'>;

export interface AuditEventPage {
  events: AuditEventSummary[];
  nextCursor: string | null;
}

interface TerritoryRow {
  id: string;
}

function toEvent(row: AuditRow): AuditEvent {
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

function toSummary(row: AuditSummaryRow): AuditEventSummary {
  return {
    id: row.id,
    organizationId: row.organization_id,
    territoryId: row.territory_id,
    actorUserId: row.actor_user_id,
    actorOrganizationId: row.actor_organization_id,
    action: row.action,
    resource: row.resource,
    resourceId: row.resource_id,
    reason: row.reason,
    requestId: row.request_id,
    occurredAt: row.occurred_at.toISOString(),
    dataClassification: row.data_classification,
    provenance: row.provenance,
  };
}

function parseCursor(value: string | undefined): { occurredAt: string; id: string } | null {
  if (!value) return null;
  const separator = value.lastIndexOf('|');
  if (separator <= 0) return null;
  const occurredAt = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (
    Number.isNaN(Date.parse(occurredAt)) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
  ) {
    return null;
  }
  return { occurredAt, id };
}

export class PostgresAuditEventRepository {
  public constructor(
    private readonly databaseUrl: string | undefined,
    private readonly transactionClient?: PoolClient,
  ) {}

  /**
   * Resolves an initial scope without exposing a territory catalogue. A
   * territory grant is most specific; national/system actors fall back to a
   * deterministic root territory in their own organization.
   */
  public async resolveDefaultTerritory(
    userId: string,
    organizationId: string,
    evaluatedAt: Date,
  ): Promise<string | null> {
    const execute = async (client: {
      query: <T>(sql: string, values: unknown[]) => Promise<{ rows: T[] }>;
    }) => {
      const result = await client.query<TerritoryRow>(
        `WITH active_grants AS (
           SELECT g.role, g.scope, g.territory_id, g.effective_from, g.id
           FROM user_role_grants g
           WHERE g.user_id = $1
             AND g.cancelled_at IS NULL
             AND g.effective_from <= $3
             AND (g.effective_until IS NULL OR g.effective_until > $3)
         ),
         territorial AS (
           SELECT g.territory_id AS id, t.code, 0 AS precedence, g.effective_from, g.id AS grant_id
           FROM active_grants g
           JOIN territories t ON t.id = g.territory_id AND t.organization_id = $2
           WHERE g.scope = 'territory'
             AND g.role IN ('regional_director', 'auditor')
         ),
         elevated AS (
           SELECT root.id, root.code, 1 AS precedence, NULL::timestamptz AS effective_from, NULL::uuid AS grant_id
           FROM territories root
           WHERE root.organization_id = $2
             AND root.parent_territory_id IS NULL
             AND EXISTS (
               SELECT 1 FROM active_grants g
               WHERE (g.role = 'system_admin' AND g.scope = 'system' AND g.territory_id IS NULL)
                  OR (g.role = 'national_admin' AND g.scope = 'national' AND g.territory_id IS NULL)
             )
         )
         SELECT id FROM (
           SELECT * FROM territorial
           UNION ALL
           SELECT * FROM elevated
         ) candidates
         ORDER BY precedence, effective_from, grant_id, code, id
         LIMIT 1`,
        [userId, organizationId, evaluatedAt],
      );
      return result.rows[0]?.id ?? null;
    };
    if (this.transactionClient) return execute(this.transactionClient);
    return withDatabase(this.databaseUrl, (pool) => execute(pool));
  }

  public async list(
    query: ListAuditEventsQuery & { territoryId: string },
  ): Promise<AuditEventPage> {
    const cursor = parseCursor(query.cursor);
    if (query.cursor && !cursor) throw new Error('Invalid audit cursor.');
    const execute = async (client: {
      query: <T>(sql: string, values: unknown[]) => Promise<{ rows: T[] }>;
    }) => {
      const values: unknown[] = [query.territoryId];
      const where = ['audit.territory_id IN (SELECT id FROM scope)'];
      const add = (sql: string, value: unknown) => {
        values.push(value);
        where.push(sql.replace('?', `$${values.length}`));
      };
      if (query.actorUserId) add('audit.actor_user_id = ?', query.actorUserId);
      if (query.action) add('audit.action = ?', query.action);
      if (query.resource) add('audit.resource = ?', query.resource);
      if (query.resourceId) add('audit.resource_id = ?', query.resourceId);
      if (query.requestId) add('audit.request_id = ?', query.requestId);
      if (query.occurredFrom) add('audit.occurred_at >= ?', query.occurredFrom);
      if (query.occurredUntil) add('audit.occurred_at < ?', query.occurredUntil);
      if (cursor) {
        values.push(cursor.occurredAt, cursor.id);
        where.push(
          `(audit.occurred_at, audit.id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`,
        );
      }
      values.push(query.limit + 1);
      const result = await client.query<AuditSummaryRow>(
        `WITH RECURSIVE selected AS (
           SELECT id, organization_id, ARRAY[id] AS path
           FROM territories WHERE id = $1
         ), scope AS (
           SELECT id, organization_id, path FROM selected
           UNION ALL
           SELECT child.id, child.organization_id, scope.path || child.id
           FROM territories child
           JOIN scope ON child.parent_territory_id = scope.id
             AND child.organization_id = scope.organization_id
           WHERE NOT child.id = ANY(scope.path)
         )
         SELECT audit.id, audit.organization_id, audit.territory_id, audit.actor_user_id, audit.actor_organization_id, audit.action, audit.resource, audit.resource_id,
                audit.reason, audit.request_id, audit.occurred_at, audit.data_classification, audit.provenance
         FROM audit_events audit
         WHERE ${where.join(' AND ')}
         ORDER BY audit.occurred_at DESC, audit.id DESC
         LIMIT $${values.length}`,
        values,
      );
      const hasMore = result.rows.length > query.limit;
      const pageRows = result.rows.slice(0, query.limit);
      const last = pageRows.at(-1);
      return {
        events: pageRows.map(toSummary),
        nextCursor: hasMore && last ? `${last.occurred_at.toISOString()}|${last.id}` : null,
      };
    };
    if (this.transactionClient) return execute(this.transactionClient);
    return withDatabase(this.databaseUrl, (pool) => execute(pool));
  }

  public async findById(eventId: string, territoryId: string): Promise<AuditEvent | null> {
    const execute = async (client: {
      query: <T>(sql: string, values: unknown[]) => Promise<{ rows: T[] }>;
    }) => {
      const result = await client.query<AuditRow>(
        `WITH RECURSIVE selected AS (
           SELECT id, organization_id, ARRAY[id] AS path
           FROM territories WHERE id = $1
         ), scope AS (
           SELECT id, organization_id, path FROM selected
           UNION ALL
           SELECT child.id, child.organization_id, scope.path || child.id
           FROM territories child
           JOIN scope ON child.parent_territory_id = scope.id
             AND child.organization_id = scope.organization_id
           WHERE NOT child.id = ANY(scope.path)
         )
         SELECT id, organization_id, territory_id, actor_user_id, actor_organization_id, action, resource, resource_id,
                old_state, new_state, reason, request_id, occurred_at, data_classification, provenance
         FROM audit_events
         WHERE id = $2 AND territory_id IN (SELECT id FROM scope)`,
        [territoryId, eventId],
      );
      return result.rows[0] ? toEvent(result.rows[0]) : null;
    };
    if (this.transactionClient) return execute(this.transactionClient);
    return withDatabase(this.databaseUrl, (pool) => execute(pool));
  }
}
