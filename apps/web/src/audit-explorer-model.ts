import {
  auditActionSchema,
  auditResourceSchema,
  type AuditEvent,
  type ListAuditEventsQuery,
} from '@isuv/contracts';

type AuditAction = AuditEvent['action'];
type AuditResource = AuditEvent['resource'];

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const auditResources: readonly AuditResource[] = auditResourceSchema.options;
export const auditActions: readonly AuditAction[] = auditActionSchema.options;

export interface AuditFilters {
  actorUserId: string;
  action: AuditAction | '';
  resource: AuditResource | '';
  resourceId: string;
  requestId: string;
  occurredFrom: string;
  occurredUntil: string;
}

export const defaultAuditFilters: AuditFilters = {
  actorUserId: '',
  action: '',
  resource: '',
  resourceId: '',
  requestId: '',
  occurredFrom: '',
  occurredUntil: '',
};

export function auditEventIdFromHash(hash: string): string | null {
  const [area, raw] = hash.replace(/^#/, '').split('?', 2);
  if (area !== 'audit') return null;
  const eventId = new URLSearchParams(raw ?? '').get('eventId');
  return eventId && uuid.test(eventId) ? eventId : null;
}

export function auditHash(eventId: string | null): string {
  return eventId && uuid.test(eventId) ? `#audit?eventId=${encodeURIComponent(eventId)}` : '#audit';
}

function utcValue(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function auditEventsPath(filters: AuditFilters, cursor: string | null = null): string {
  const query = new URLSearchParams({ limit: '25' });
  const values: Partial<ListAuditEventsQuery> = {
    actorUserId: filters.actorUserId || undefined,
    action: filters.action || undefined,
    resource: filters.resource || undefined,
    resourceId: filters.resourceId || undefined,
    requestId: filters.requestId || undefined,
    occurredFrom: utcValue(filters.occurredFrom),
    occurredUntil: utcValue(filters.occurredUntil),
    cursor: cursor ?? undefined,
  };
  for (const [key, value] of Object.entries(values)) if (value) query.set(key, String(value));
  return `/api/v1/audit/events?${query.toString()}`;
}

export function auditEventPath(eventId: string, territoryId: string | null): string {
  const query = territoryId ? `?territoryId=${encodeURIComponent(territoryId)}` : '';
  return `/api/v1/audit/events/${encodeURIComponent(eventId)}${query}`;
}

export function auditTimestamp(value: string): string {
  return value.replace('T', ' ').replace('Z', ' UTC');
}
