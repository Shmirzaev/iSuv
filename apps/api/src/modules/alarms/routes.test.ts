import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { TerritoryAuthorizationRepository } from '../authorization/service.js';
import type { IdentityProvider } from '../identity/provider.js';
import type { IdentitySessionRepository } from '../identity/repository.js';
import { registerAlarmRoutes } from './routes.js';
import type { PostgresAlarmService } from './service.js';

const ids = {
  user: '11000000-0000-4000-8000-000000000001',
  territory: '11000000-0000-4000-8000-000000000002',
  catalog: '11000000-0000-4000-8000-000000000003',
  rule: '11000000-0000-4000-8000-000000000004',
  grant: '11000000-0000-4000-8000-000000000005',
};
const identity = { resolve: async () => ({ userId: ids.user }) } as unknown as IdentityProvider;
const sessions = {
  findCurrentSession: async () => ({ user: { id: ids.user } }),
} as unknown as IdentitySessionRepository;
const allowed = {
  findEffectiveGrantsForTarget: async () => [
    {
      id: ids.grant,
      role: 'national_admin',
      scope: 'national',
      territoryId: null,
      coversTargetTerritory: true,
    },
  ],
} as unknown as TerritoryAuthorizationRepository;
const catalog = {
  territoryId: ids.territory,
  eventType: 'high_stage',
  title: 'Synthetic high stage',
  provenance: 'synthetic:alarm-route-test',
  reason: 'test catalog',
};
const version = {
  effectiveFrom: '2030-01-01T00:00:00.000000Z',
  effectiveUntil: '2030-01-02T00:00:00.000000Z',
  ruleId: ids.rule,
  activationSupport: 'p4_001_rule_signal',
  waterCondition: 'high_stage',
  systemDeviceCondition: 'not_assessed',
  severity: 'warning',
  provenance: 'synthetic:alarm-route-test',
  reason: 'test mapping',
};

test('alarm routes reject malformed identifiers and caller-authored materialization policy', async () => {
  let lookups = 0;
  const app = Fastify();
  registerAlarmRoutes(app, {
    identityProvider: identity,
    sessionRepository: sessions,
    authorizationRepository: allowed,
    service: {
      findCatalogScope: async () => {
        lookups += 1;
        return null;
      },
    } as unknown as PostgresAlarmService,
  });
  const malformed = await app.inject({
    method: 'POST',
    url: '/api/v1/alarm-catalog/nope/versions/request',
    payload: version,
  });
  const forged = await app.inject({
    method: 'POST',
    url: '/api/v1/alarms/materialize',
    payload: {
      ruleId: ids.rule,
      effectiveAt: '2030-01-01T00:00:00Z',
      knownAt: '2030-01-01T00:00:00Z',
      severity: 'critical',
    },
  });
  assert.equal(malformed.statusCode, 400);
  assert.equal(forged.statusCode, 400);
  assert.equal(lookups, 0);
  await app.close();
});

test('anonymous alarm requests authenticate before validation or resource lookup', async () => {
  let identityCalls = 0;
  let sessionCalls = 0;
  let serviceCalls = 0;
  let authorizationCalls = 0;
  const app = Fastify();
  registerAlarmRoutes(app, {
    identityProvider: {
      resolve: async () => {
        identityCalls += 1;
        return null;
      },
    } as unknown as IdentityProvider,
    sessionRepository: {
      findCurrentSession: async () => {
        sessionCalls += 1;
        return null;
      },
    } as unknown as IdentitySessionRepository,
    authorizationRepository: {
      findEffectiveGrantsForTarget: async () => {
        authorizationCalls += 1;
        return [];
      },
    } as unknown as TerritoryAuthorizationRepository,
    service: {
      findTerritory: async () => {
        serviceCalls += 1;
        return null;
      },
      findCatalogScope: async () => {
        serviceCalls += 1;
        return null;
      },
      findRuleScope: async () => {
        serviceCalls += 1;
        return null;
      },
    } as unknown as PostgresAlarmService,
  });
  const responses = await Promise.all([
    app.inject({ method: 'POST', url: '/api/v1/alarm-catalog', payload: {} }),
    app.inject({
      method: 'POST',
      url: '/api/v1/alarm-catalog/not-a-uuid/versions/request',
      payload: {},
    }),
    app.inject({
      method: 'POST',
      url: '/api/v1/alarm-catalog/not-a-uuid/versions/not-a-version/approve',
      payload: {},
    }),
    app.inject({ method: 'GET', url: '/api/v1/alarm-catalog/not-a-uuid?effectiveAt=nope' }),
    app.inject({ method: 'POST', url: '/api/v1/alarms/materialize', payload: {} }),
  ]);
  for (const response of responses) {
    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json().error, {
      code: 'UNAUTHENTICATED',
      message: 'Authentication is required.',
      requestId: response.json().error.requestId,
    });
  }
  assert.equal(identityCalls, responses.length);
  assert.equal(sessionCalls, 0);
  assert.equal(serviceCalls, 0);
  assert.equal(authorizationCalls, 0);
  await app.close();
});

test('alarm authoring authenticates before lookup and denied scope never mutates', async () => {
  let lookups = 0;
  let mutations = 0;
  const service = {
    findTerritory: async () => {
      lookups += 1;
      return ids.territory;
    },
    create: async () => {
      mutations += 1;
      throw new Error('must not run');
    },
  } as unknown as PostgresAlarmService;
  const anonymous = Fastify();
  registerAlarmRoutes(anonymous, {
    identityProvider: { resolve: async () => null },
    sessionRepository: sessions,
    authorizationRepository: allowed,
    service,
  });
  assert.equal(
    (await anonymous.inject({ method: 'POST', url: '/api/v1/alarm-catalog', payload: catalog }))
      .statusCode,
    401,
  );
  assert.equal(lookups, 0);
  await anonymous.close();
  const denied = Fastify();
  registerAlarmRoutes(denied, {
    identityProvider: identity,
    sessionRepository: sessions,
    authorizationRepository: {
      findEffectiveGrantsForTarget: async () => [],
    } as unknown as TerritoryAuthorizationRepository,
    service,
  });
  assert.equal(
    (await denied.inject({ method: 'POST', url: '/api/v1/alarm-catalog', payload: catalog }))
      .statusCode,
    404,
  );
  assert.equal(lookups, 1);
  assert.equal(mutations, 0);
  await denied.close();
});

test('alarm dependencies fail as typed 503 across catalog and materialization mutations', async () => {
  const service = {
    findTerritory: async () => ids.territory,
    findCatalogScope: async () => ({ territoryId: ids.territory }),
    findRuleScope: async () => ({
      territoryId: ids.territory,
      subjectKind: 'observation_sensor' as const,
    }),
    create: async () => {
      throw new Error('down');
    },
    requestVersion: async () => {
      throw new Error('down');
    },
    approveVersion: async () => {
      throw new Error('down');
    },
    materialize: async () => {
      throw new Error('down');
    },
  } as unknown as PostgresAlarmService;
  const app = Fastify();
  registerAlarmRoutes(app, {
    identityProvider: identity,
    sessionRepository: sessions,
    authorizationRepository: allowed,
    service,
  });
  const responses = [
    await app.inject({ method: 'POST', url: '/api/v1/alarm-catalog', payload: catalog }),
    await app.inject({
      method: 'POST',
      url: `/api/v1/alarm-catalog/${ids.catalog}/versions/request`,
      payload: version,
    }),
    await app.inject({
      method: 'POST',
      url: `/api/v1/alarm-catalog/${ids.catalog}/versions/1/approve`,
      payload: { reason: 'approve' },
    }),
    await app.inject({
      method: 'POST',
      url: '/api/v1/alarms/materialize',
      payload: {
        ruleId: ids.rule,
        effectiveAt: '2030-01-01T00:00:00Z',
        knownAt: '2030-01-01T00:00:00Z',
      },
    }),
  ];
  assert.deepEqual(
    responses.map((response) => response.statusCode),
    [503, 503, 503, 503],
  );
  await app.close();
});
