import assert from 'node:assert/strict';
import test from 'node:test';
import {
  auditActionSchema,
  auditEventResponseSchema,
  auditEventsResponseSchema,
  auditStateMaximumBytes,
  listAuditEventsQuerySchema,
} from './audit.js';

const ids = {
  event: 'a1000000-0000-4000-8000-000000000001',
  organization: 'a2000000-0000-4000-8000-000000000001',
  territory: 'a3000000-0000-4000-8000-000000000001',
  actor: 'a4000000-0000-4000-8000-000000000001',
  resource: 'a5000000-0000-4000-8000-000000000001',
};

test('audit explorer query defaults to 25 and strictly validates exact filters and half-open time', () => {
  const parsed = listAuditEventsQuerySchema.parse({
    resourceId: ids.resource,
    requestId: 'request-123',
    occurredFrom: '2026-01-01T00:00:00.000Z',
    occurredUntil: '2026-01-02T00:00:00.000Z',
  });
  assert.equal(parsed.limit, 25);
  assert.equal(parsed.resourceId, ids.resource);
  assert.equal(parsed.requestId, 'request-123');
  assert.equal(
    listAuditEventsQuerySchema.safeParse({
      occurredFrom: '2026-01-02T00:00:00.000Z',
      occurredUntil: '2026-01-02T00:00:00.000Z',
    }).success,
    false,
  );
  assert.equal(listAuditEventsQuerySchema.safeParse({ limit: 101 }).success, false);
});

test('audit list summaries cannot contain state while event detail preserves immutable state', () => {
  const base = {
    id: ids.event,
    organizationId: ids.organization,
    territoryId: ids.territory,
    actorUserId: ids.actor,
    actorOrganizationId: ids.organization,
    action: 'user_role_grant.created' as const,
    resource: 'user_role_grant' as const,
    resourceId: ids.resource,
    reason: 'Synthetic permission grant.',
    requestId: 'request-123',
    occurredAt: '2026-01-01T00:00:00.000Z',
    dataClassification: 'synthetic' as const,
    provenance: 'test',
  };
  assert.equal(
    auditEventsResponseSchema.safeParse({
      scope: { territoryId: ids.territory, includesDescendants: true },
      events: [{ ...base, oldState: null }],
      nextCursor: null,
    }).success,
    false,
  );
  assert.deepEqual(
    auditEventResponseSchema.parse({
      scope: { territoryId: ids.territory, includesDescendants: true },
      event: { ...base, oldState: null, newState: { role: 'auditor' } },
    }).event.newState,
    { role: 'auditor' },
  );
});

test('audit explorer does not invent identity or infrastructure-control event classes', () => {
  for (const action of auditActionSchema.options)
    assert.doesNotMatch(action, /(login|logout|mfa|valve|gate|pump|plc|rtu|command)/i);
});

test('audit detail preserves exact state only within the deterministic UTF-8 byte budget', () => {
  const base = {
    id: ids.event,
    organizationId: ids.organization,
    territoryId: ids.territory,
    actorUserId: ids.actor,
    actorOrganizationId: ids.organization,
    action: 'report.generated' as const,
    resource: 'report' as const,
    resourceId: ids.resource,
    oldState: null,
    reason: 'Bound immutable audit evidence.',
    requestId: 'request-state-budget',
    occurredAt: '2026-01-01T00:00:00.000Z',
    dataClassification: 'synthetic' as const,
    provenance: 'test',
  };
  const withinBudget = { payload: 'x'.repeat(auditStateMaximumBytes - 32) };
  const overBudget = { payload: 'x'.repeat(auditStateMaximumBytes) };
  assert.equal(
    auditEventResponseSchema.safeParse({
      scope: { territoryId: ids.territory, includesDescendants: true },
      event: { ...base, newState: withinBudget },
    }).success,
    true,
  );
  assert.equal(
    auditEventResponseSchema.safeParse({
      scope: { territoryId: ids.territory, includesDescendants: true },
      event: { ...base, newState: overBudget },
    }).success,
    false,
  );
});
