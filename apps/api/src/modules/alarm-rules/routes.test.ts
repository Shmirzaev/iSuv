import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { TerritoryAuthorizationRepository } from '../authorization/service.js';
import type { IdentityProvider } from '../identity/provider.js';
import type { IdentitySessionRepository } from '../identity/repository.js';
import { registerAlarmRuleRoutes } from './routes.js';
import type { PostgresAlarmRuleService } from './service.js';

const ids = {
  rule: '10000000-0000-4000-8000-000000000001',
  territory: '10000000-0000-4000-8000-000000000002',
  sensor: '10000000-0000-4000-8000-000000000003',
  user: '10000000-0000-4000-8000-000000000004',
  grant: '10000000-0000-4000-8000-000000000005',
  version: '10000000-0000-4000-8000-000000000006',
};
const identity = {
  resolve: async () => ({ userId: ids.user, externalSubject: 'alarm-rule-test' }),
} as unknown as IdentityProvider;
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
const createPayload = {
  territoryId: ids.territory,
  subjectKind: 'observation_sensor',
  subjectId: ids.sensor,
  provenance: 'synthetic:route-test',
  reason: 'create governed test rule',
};
const versionPayload = {
  effectiveFrom: '2030-01-01T00:00:00.000000Z',
  effectiveUntil: '2030-01-02T00:00:00.000000Z',
  provenance: 'synthetic:route-test',
  reason: 'request governed test rule',
  condition: {
    kind: 'observation_threshold',
    sensorId: ids.sensor,
    quantity: 'stage',
    unit: 'm',
    direction: 'high',
    enter: '2',
    clear: '1',
    enterPersistenceMicroseconds: '1000000',
    clearPersistenceMicroseconds: '1000000',
    maxGapMicroseconds: '2000000',
    uncertaintyBound: '0.1',
    rateGate: null,
  },
};

test('alarm rule routes reject malformed identifiers and policy before lookup', async () => {
  let lookups = 0;
  const app = Fastify();
  registerAlarmRuleRoutes(app, {
    identityProvider: identity,
    sessionRepository: sessions,
    authorizationRepository: allowed,
    service: {
      findRuleScope: async () => {
        lookups += 1;
        return null;
      },
    } as unknown as PostgresAlarmRuleService,
  });
  const invalidId = await app.inject({
    method: 'POST',
    url: '/api/v1/alarm-rules/not-a-uuid/versions/request',
    payload: versionPayload,
  });
  const invalidPolicy = await app.inject({
    method: 'POST',
    url: `/api/v1/alarm-rules/${ids.rule}/versions/request`,
    payload: {
      ...versionPayload,
      condition: { ...versionPayload.condition, severity: 'critical' },
    },
  });
  assert.equal(invalidId.statusCode, 400);
  assert.equal(invalidPolicy.statusCode, 400);
  assert.equal(lookups, 0);
  await app.close();
});

test('anonymous alarm-rule requests authenticate before validation or resource lookup', async () => {
  let identityCalls = 0;
  let sessionCalls = 0;
  let serviceCalls = 0;
  let authorizationCalls = 0;
  const app = Fastify();
  registerAlarmRuleRoutes(app, {
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
      findRuleScope: async () => {
        serviceCalls += 1;
        return null;
      },
    } as unknown as PostgresAlarmRuleService,
  });
  const responses = await Promise.all([
    app.inject({ method: 'POST', url: '/api/v1/alarm-rules', payload: {} }),
    app.inject({
      method: 'POST',
      url: '/api/v1/alarm-rules/not-a-uuid/versions/request',
      payload: {},
    }),
    app.inject({
      method: 'POST',
      url: '/api/v1/alarm-rules/not-a-uuid/versions/not-a-version/approve',
      payload: {},
    }),
    app.inject({
      method: 'POST',
      url: '/api/v1/alarm-rules/not-a-uuid/evaluate',
      payload: {},
    }),
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

test('alarm authoring authenticates before lookup and never mutates when scope is denied', async () => {
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
  } as unknown as PostgresAlarmRuleService;
  const anonymous = Fastify();
  registerAlarmRuleRoutes(anonymous, {
    identityProvider: { resolve: async () => null },
    sessionRepository: sessions,
    authorizationRepository: allowed,
    service,
  });
  const unauthenticated = await anonymous.inject({
    method: 'POST',
    url: '/api/v1/alarm-rules',
    payload: createPayload,
  });
  assert.equal(unauthenticated.statusCode, 401);
  assert.equal(lookups, 0);
  await anonymous.close();

  const denied = Fastify();
  registerAlarmRuleRoutes(denied, {
    identityProvider: identity,
    sessionRepository: sessions,
    authorizationRepository: {
      findEffectiveGrantsForTarget: async () => [],
    } as unknown as TerritoryAuthorizationRepository,
    service,
  });
  const unauthorized = await denied.inject({
    method: 'POST',
    url: '/api/v1/alarm-rules',
    payload: createPayload,
  });
  assert.equal(unauthorized.statusCode, 404);
  assert.equal(lookups, 1);
  assert.equal(mutations, 0);
  await denied.close();
});

test('alarm-rule dependency failures are typed 503 for every mutation and evaluation', async () => {
  const service = {
    findTerritory: async () => ids.territory,
    findRuleScope: async () => ({
      territoryId: ids.territory,
      subjectKind: 'observation_sensor' as const,
      subjectId: ids.sensor,
    }),
    create: async () => {
      throw new Error('database unavailable');
    },
    request: async () => {
      throw new Error('database unavailable');
    },
    approve: async () => {
      throw new Error('database unavailable');
    },
    evaluate: async () => {
      throw new Error('database unavailable');
    },
  } as unknown as PostgresAlarmRuleService;
  const app = Fastify();
  registerAlarmRuleRoutes(app, {
    identityProvider: identity,
    sessionRepository: sessions,
    authorizationRepository: allowed,
    service,
  });
  const responses = [
    await app.inject({ method: 'POST', url: '/api/v1/alarm-rules', payload: createPayload }),
    await app.inject({
      method: 'POST',
      url: `/api/v1/alarm-rules/${ids.rule}/versions/request`,
      payload: versionPayload,
    }),
    await app.inject({
      method: 'POST',
      url: `/api/v1/alarm-rules/${ids.rule}/versions/1/approve`,
      payload: { reason: 'approve test rule' },
    }),
    await app.inject({
      method: 'POST',
      url: `/api/v1/alarm-rules/${ids.rule}/evaluate`,
      payload: {
        effectiveAt: '2030-01-01T01:00:00.000000Z',
        knownAt: '2030-01-02T00:00:00.000000Z',
      },
    }),
  ];
  for (const response of responses) {
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error.code, 'UNAVAILABLE');
  }
  await app.close();
});

test('evaluation accepts only configured cutoff fields and strict positive approval versions', async () => {
  let evaluations = 0;
  let lookups = 0;
  const app = Fastify();
  registerAlarmRuleRoutes(app, {
    identityProvider: identity,
    sessionRepository: sessions,
    authorizationRepository: allowed,
    service: {
      findRuleScope: async () => {
        lookups += 1;
        return {
          territoryId: ids.territory,
          subjectKind: 'observation_sensor',
          subjectId: ids.sensor,
        };
      },
      evaluate: async () => {
        evaluations += 1;
        throw new Error('must not run for invalid input');
      },
    } as unknown as PostgresAlarmRuleService,
  });
  const forged = await app.inject({
    method: 'POST',
    url: `/api/v1/alarm-rules/${ids.rule}/evaluate`,
    payload: {
      effectiveAt: '2030-01-01T01:00:00.000000Z',
      value: '999',
      severity: 'critical',
    },
  });
  assert.equal(forged.statusCode, 400);
  for (const version of ['0', '-1', '1.0']) {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/alarm-rules/${ids.rule}/versions/${version}/approve`,
      payload: { reason: 'invalid version' },
    });
    assert.equal(response.statusCode, 400);
  }
  assert.equal(lookups, 0);
  assert.equal(evaluations, 0);
  await app.close();
});
