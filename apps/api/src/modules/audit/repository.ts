import type { AuditEvent, ListAuditEventsQuery } from '@isuv/contracts';
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

export interface AuditEventPage {
  events: AuditEvent[];
  nextCursor: string | null;
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

  public async list(
    query: ListAuditEventsQuery & { territoryId: string },
  ): Promise<AuditEventPage> {
    const cursor = parseCursor(query.cursor);
    if (query.cursor && !cursor) throw new Error('Invalid audit cursor.');
    const execute = async (client: {
      query: <T>(sql: string, values: unknown[]) => Promise<{ rows: T[] }>;
    }) => {
      const values: unknown[] = [query.territoryId];
      const where = ['territory_id = $1'];
      const add = (sql: string, value: unknown) => {
        values.push(value);
        where.push(sql.replace('?', `$${values.length}`));
      };
      if (query.actorUserId) add('actor_user_id = ?', query.actorUserId);
      if (query.action) add('action = ?', query.action);
      if (query.resource) add('resource = ?', query.resource);
      if (query.occurredFrom) add('occurred_at >= ?', query.occurredFrom);
      if (query.occurredUntil) add('occurred_at < ?', query.occurredUntil);
      if (cursor) {
        values.push(cursor.occurredAt, cursor.id);
        where.push(
          `(occurred_at, id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`,
        );
      }
      values.push(query.limit + 1);
      const result = await client.query<AuditRow>(
        `SELECT id, organization_id, territory_id, actor_user_id, actor_organization_id, action, resource, resource_id,
                old_state, new_state, reason, request_id, occurred_at, data_classification, provenance
         FROM audit_events
         WHERE ${where.join(' AND ')}
         ORDER BY occurred_at DESC, id DESC
         LIMIT $${values.length}`,
        values,
      );
      const hasMore = result.rows.length > query.limit;
      const pageRows = result.rows.slice(0, query.limit);
      const last = pageRows.at(-1);
      return {
        events: pageRows.map(toEvent),
        nextCursor: hasMore && last ? `${last.occurred_at.toISOString()}|${last.id}` : null,
      };
    };
    if (this.transactionClient) return execute(this.transactionClient);
    return withDatabase(this.databaseUrl, (pool) => execute(pool));
  }
}
