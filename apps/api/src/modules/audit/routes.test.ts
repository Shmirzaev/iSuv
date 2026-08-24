import assert from 'node:assert/strict';
import test from 'node:test';
import { auditEventSummarySchema, type Session } from '@isuv/contracts';
import type { EffectiveGrant } from '@isuv/domain';
import Fastify from 'fastify';
import { registerAuditRoutes } from './routes.js';

const territoryId = 'c2000000-0000-4000-8000-000000000001';
const actorUserId = 'c3000000-0000-4000-8000-000000000001';
const organizationId = 'c1000000-0000-4000-8000-000000000001';
const eventId = 'c5000000-0000-4000-8000-000000000001';

const session: Session = {
  user: {
    id: actorUserId,
    organizationId,
    externalSubject: 'synthetic:audit-auditor',
    displayName: 'Audit auditor',
    isActive: true,
    dataClassification: 'synthetic',
  },
  organization: {
    id: organizationId,
    code: 'AUDIT',
    name: 'Audit',
    dataClassification: 'synthetic',
  },
  currentGrants: [],
  resolvedAt: '2026-04-01T00:00:00.000Z',
};

function grant(coversTargetTerritory: boolean): EffectiveGrant {
  return {
    id: 'c4000000-0000-4000-8000-000000000001',
    role: 'auditor',
    scope: 'territory',
    territoryId,
    coversTargetTerritory,
  };
}

const fullEvent = {
  id: eventId,
  organizationId,
  territoryId,
  actorUserId,
  actorOrganizationId: organizationId,
  action: 'user_role_grant.created' as const,
  resource: 'user_role_grant' as const,
  resourceId: 'c6000000-0000-4000-8000-000000000001',
  oldState: null,
  newState: { role: 'auditor' },
  reason: 'Synthetic audit event.',
  requestId: 'audit-request-id',
  occurredAt: '2026-04-01T00:00:00.000Z',
  dataClassification: 'synthetic' as const,
  provenance: 'test',
};

test('audit listing is territory-authorized, typed, and preserves the request id', async () => {
  const app = Fastify();
  registerAuditRoutes(app, {
    identityProvider: {
      async resolve() {
        return { userId: actorUserId, provider: 'local-development' as const };
      },
    },
    sessionRepository: {
      async findCurrentSession() {
        return session;
      },
    },
    authorizationRepository: {
      async findEffectiveGrantsForTarget() {
        return [grant(true)];
      },
    },
    auditRepository: {
      async list() {
        return {
          events: [],
          nextCursor: null,
        };
      },
    } as never,
    now: () => new Date('2026-04-01T00:00:00.000Z'),
  });
  const response = await app.inject({
    method: 'GET',
    url: `/api/v1/audit/events?territoryId=${territoryId}&limit=1`,
    headers: { 'x-request-id': 'audit-request-id' },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    scope: { territoryId, includesDescendants: true },
    events: [],
    nextCursor: null,
  });
  await app.close();
});

test('audit listing does not enumerate unauthorized territory data', async () => {
  const app = Fastify();
  registerAuditRoutes(app, {
    identityProvider: {
      async resolve() {
        return { userId: actorUserId, provider: 'local-development' as const };
      },
    },
    sessionRepository: {
      async findCurrentSession() {
        return session;
      },
    },
    authorizationRepository: {
      async findEffectiveGrantsForTarget() {
        return [grant(false)];
      },
    },
    auditRepository: {
      async list() {
        throw new Error('must not list');
      },
    } as never,
  });
  const response = await app.inject({
    method: 'GET',
    url: `/api/v1/audit/events?territoryId=${territoryId}`,
  });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error.code, 'NOT_FOUND');
  await app.close();
});

test('audit authentication happens before invalid caller filters are evaluated', async () => {
  const app = Fastify();
  let sessionLookups = 0;
  registerAuditRoutes(app, {
    identityProvider: {
      async resolve() {
        return null;
      },
    },
    sessionRepository: {
      async findCurrentSession() {
        sessionLookups += 1;
        return session;
      },
    },
    authorizationRepository: {
      async findEffectiveGrantsForTarget() {
        return [grant(true)];
      },
    },
    auditRepository: {
      async list() {
        throw new Error('must not list');
      },
    } as never,
  });
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/audit/events?limit=not-a-number',
  });
  assert.equal(response.statusCode, 401);
  assert.equal(sessionLookups, 0);
  await app.close();
});

test('audit list resolves a deterministic authorized default scope and details retain immutable state', async () => {
  const app = Fastify();
  let defaultCalls = 0;
  registerAuditRoutes(app, {
    identityProvider: {
      async resolve() {
        return { userId: actorUserId, provider: 'local-development' as const };
      },
    },
    sessionRepository: {
      async findCurrentSession() {
        return session;
      },
    },
    authorizationRepository: {
      async findEffectiveGrantsForTarget() {
        return [grant(true)];
      },
    },
    auditRepository: {
      async resolveDefaultTerritory() {
        defaultCalls += 1;
        return territoryId;
      },
      async list(query: { territoryId: string; limit: number }) {
        assert.equal(query.territoryId, territoryId);
        assert.equal(query.limit, 25);
        const compact = Object.fromEntries(
          Object.entries(fullEvent).filter(([key]) => key !== 'oldState' && key !== 'newState'),
        );
        return { events: [auditEventSummarySchema.parse(compact)], nextCursor: null };
      },
      async findById(id: string, selectedTerritoryId: string) {
        assert.equal(id, eventId);
        assert.equal(selectedTerritoryId, territoryId);
        return fullEvent;
      },
    } as never,
  });
  const list = await app.inject({ method: 'GET', url: '/api/v1/audit/events' });
  assert.equal(list.statusCode, 200, list.body);
  assert.equal(defaultCalls, 1);
  assert.equal(list.json().events[0].oldState, undefined);
  const detail = await app.inject({ method: 'GET', url: `/api/v1/audit/events/${eventId}` });
  assert.equal(detail.statusCode, 200);
  assert.deepEqual(detail.json().event.newState, { role: 'auditor' });
  await app.close();
});

test('audit detail hides an absent or out-of-scope event with the same 404', async () => {
  const app = Fastify();
  registerAuditRoutes(app, {
    identityProvider: {
      async resolve() {
        return { userId: actorUserId, provider: 'local-development' as const };
      },
    },
    sessionRepository: {
      async findCurrentSession() {
        return session;
      },
    },
    authorizationRepository: {
      async findEffectiveGrantsForTarget() {
        return [grant(true)];
      },
    },
    auditRepository: {
      async resolveDefaultTerritory() {
        return territoryId;
      },
      async findById() {
        return null;
      },
    } as never,
  });
  const response = await app.inject({ method: 'GET', url: `/api/v1/audit/events/${eventId}` });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error.code, 'NOT_FOUND');
  await app.close();
});
