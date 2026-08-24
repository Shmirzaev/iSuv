import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import type { TerritoryAuthorizationRepository } from '../authorization/service.js';
import type { IdentityProvider } from '../identity/provider.js';
import type { IdentitySessionRepository } from '../identity/repository.js';
import type { PostgresWaterBalanceService } from './service.js';
import { registerWaterBalanceRoutes } from './routes.js';
const modelId = '11111111-1111-4111-8111-111111111111';
const junctionId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';
const territoryId = '44444444-4444-4444-8444-444444444444';
const sourceId = '55555555-5555-4555-8555-555555555555';
const identityProvider = {
  resolve: async () => ({ userId, externalSubject: 'water-balance-test' }),
} as unknown as IdentityProvider;
const sessionRepository = {
  findCurrentSession: async () => ({ user: { id: userId } }),
} as unknown as IdentitySessionRepository;
const allowed = {
  findEffectiveGrantsForTarget: async () => [
    {
      id: sourceId,
      role: 'national_admin',
      scope: 'national',
      territoryId: null,
      coversTargetTerritory: true,
    },
  ],
} as unknown as TerritoryAuthorizationRepository;
const versionPayload = {
  effectiveFrom: '2030-01-01T00:00:00.000000Z',
  effectiveUntil: '2030-01-01T01:00:00.000000Z',
  provenance: 'synthetic:route-test',
  reason: 'exercise degraded dependency handling',
  components: [
    {
      waterSectionId: sourceId,
      stationId: sourceId,
      sensorId: sourceId,
      deviceInstallationId: sourceId,
      method: 'direct_discharge',
      role: 'incoming',
      referencePlane: 'downstream',
      travelTimeMicroseconds: '0',
      provenance: 'synthetic:route-test',
    },
  ],
  assumptions: [
    {
      intervalStart: '2030-01-01T00:00:00.000000Z',
      intervalEnd: '2030-01-01T01:00:00.000000Z',
      storageChangeM3: '0',
      knownAdditionM3: '0',
      knownRemovalM3: '0',
      provenance: 'synthetic:route-test',
    },
  ],
};
test('water balance routes authenticate before parsing malformed targets or consulting protected dependencies', async () => {
  let identityCalls = 0;
  let sessionCalls = 0;
  let authorizationCalls = 0;
  let lookupCalls = 0;
  const app = Fastify();
  registerWaterBalanceRoutes(app, {
    identityProvider: {
      async resolve() {
        identityCalls += 1;
        return null;
      },
    } as IdentityProvider,
    sessionRepository: {
      async findCurrentSession() {
        sessionCalls += 1;
        return null;
      },
    } as unknown as IdentitySessionRepository,
    authorizationRepository: {
      async findEffectiveGrantsForTarget() {
        authorizationCalls += 1;
        return [];
      },
    } as unknown as TerritoryAuthorizationRepository,
    service: {
      async findCalculationTerritories() {
        lookupCalls += 1;
        return [];
      },
      async findJunctionTerritories() {
        lookupCalls += 1;
        return [];
      },
      async findModelTerritories() {
        lookupCalls += 1;
        return [];
      },
    } as unknown as PostgresWaterBalanceService,
  });
  const requests = [
    { method: 'GET', url: '/api/v1/network/junctions/not-a-uuid/water-balance?from=invalid' },
    { method: 'POST', url: '/api/v1/water-balance-models', payload: {} },
    {
      method: 'POST',
      url: '/api/v1/water-balance-models/not-a-uuid/versions/request',
      payload: {},
    },
    {
      method: 'POST',
      url: '/api/v1/water-balance-models/not-a-uuid/versions/zero/approve',
      payload: {},
    },
    {
      method: 'POST',
      url: '/api/v1/water-balance-models',
      payload: {
        junctionId,
        provenance: 'synthetic:route-test',
        reason: 'well-formed target must remain private',
      },
    },
  ] as const;
  for (const request of requests) {
    const response = await app.inject(request);
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error.code, 'UNAUTHENTICATED');
  }
  assert.equal(identityCalls, requests.length);
  assert.equal(sessionCalls, 0);
  assert.equal(authorizationCalls, 0);
  assert.equal(lookupCalls, 0);
  await app.close();
});

test('water balance routes retain authenticated validation errors without resource access', async () => {
  let lookupCalls = 0;
  const app = Fastify();
  registerWaterBalanceRoutes(app, {
    identityProvider,
    sessionRepository,
    authorizationRepository: allowed,
    service: {
      async findCalculationTerritories() {
        lookupCalls += 1;
        return [];
      },
    } as unknown as PostgresWaterBalanceService,
  });
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/network/junctions/not-a-uuid/water-balance',
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, 'VALIDATION_ERROR');
  assert.equal(lookupCalls, 0);
  await app.close();
});

test('water balance mutations convert unexpected dependency failures to typed 503 responses', async () => {
  const service = {
    findJunctionTerritories: async () => [territoryId],
    findModelTerritories: async () => [territoryId],
    create: async () => {
      throw new Error('database unavailable');
    },
    request: async () => {
      throw new Error('database unavailable');
    },
    approve: async () => {
      throw new Error('database unavailable');
    },
  } as unknown as PostgresWaterBalanceService;
  const app = Fastify();
  registerWaterBalanceRoutes(app, {
    identityProvider,
    sessionRepository,
    authorizationRepository: allowed,
    service,
  });
  const responses = [
    await app.inject({
      method: 'POST',
      url: '/api/v1/water-balance-models',
      payload: {
        junctionId,
        provenance: 'synthetic:route-test',
        reason: 'exercise degraded dependency handling',
      },
    }),
    await app.inject({
      method: 'POST',
      url: `/api/v1/water-balance-models/${modelId}/versions/request`,
      payload: versionPayload,
    }),
    await app.inject({
      method: 'POST',
      url: `/api/v1/water-balance-models/${modelId}/versions/1/approve`,
      payload: { reason: 'exercise degraded dependency handling' },
    }),
  ];
  for (const response of responses) {
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error.code, 'UNAVAILABLE');
  }
  await app.close();
});

test('water balance authoring authenticates before lookup and never mutates when denied', async () => {
  let lookups = 0;
  let mutations = 0;
  const service = {
    findJunctionTerritories: async () => {
      lookups += 1;
      return [territoryId];
    },
    create: async () => {
      mutations += 1;
      throw new Error('must not be called');
    },
  } as unknown as PostgresWaterBalanceService;
  const payload = {
    junctionId,
    provenance: 'synthetic:route-test',
    reason: 'exercise auth ordering',
  };
  const anonymous = Fastify();
  registerWaterBalanceRoutes(anonymous, {
    identityProvider: { resolve: async () => null },
    sessionRepository,
    authorizationRepository: allowed,
    service,
  });
  const unauthenticated = await anonymous.inject({
    method: 'POST',
    url: '/api/v1/water-balance-models',
    payload,
  });
  assert.equal(unauthenticated.statusCode, 401);
  assert.equal(lookups, 0);
  await anonymous.close();

  const denied = Fastify();
  registerWaterBalanceRoutes(denied, {
    identityProvider,
    sessionRepository,
    authorizationRepository: {
      findEffectiveGrantsForTarget: async () => [],
    } as unknown as TerritoryAuthorizationRepository,
    service,
  });
  const unauthorized = await denied.inject({
    method: 'POST',
    url: '/api/v1/water-balance-models',
    payload,
  });
  assert.equal(unauthorized.statusCode, 404);
  assert.equal(lookups, 1);
  assert.equal(mutations, 0);
  await denied.close();
});

test('water balance approval rejects non-positive or non-canonical versions before lookup', async () => {
  let lookups = 0;
  const app = Fastify();
  registerWaterBalanceRoutes(app, {
    identityProvider,
    sessionRepository,
    authorizationRepository: allowed,
    service: {
      findModelTerritories: async () => {
        lookups += 1;
        return [territoryId];
      },
    } as unknown as PostgresWaterBalanceService,
  });
  for (const version of ['0', '-1', '1.0']) {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/water-balance-models/${modelId}/versions/${version}/approve`,
      payload: { reason: 'invalid version' },
    });
    assert.equal(response.statusCode, 400);
  }
  assert.equal(lookups, 0);
  await app.close();
});
