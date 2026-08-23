import assert from 'node:assert/strict';
import test from 'node:test';
import type { Session } from '@isuv/contracts';
import type { EffectiveGrant } from '@isuv/domain';
import Fastify from 'fastify';
import { registerAuditRoutes } from './routes.js';

const territoryId = 'c2000000-0000-4000-8000-000000000001';
const actorUserId = 'c3000000-0000-4000-8000-000000000001';
const organizationId = 'c1000000-0000-4000-8000-000000000001';

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
  assert.deepEqual(response.json(), { events: [], nextCursor: null });
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
