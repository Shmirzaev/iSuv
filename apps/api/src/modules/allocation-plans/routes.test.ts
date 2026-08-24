import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../../app.js';
import type { IdentityProvider } from '../identity/provider.js';
import type { IdentitySessionRepository } from '../identity/repository.js';
import type { TerritoryAuthorizationRepository } from '../authorization/service.js';
import type { PostgresAllocationPlanService } from './service.js';
const userId = 'a3000000-0000-4000-8000-000000000001';
const territoryId = 'a2000000-0000-4000-8000-000000000004';
const planId = 'b2000000-0000-4000-8000-000000000001';
const identity: IdentityProvider = {
  async resolve() {
    return { userId, provider: 'local-development' };
  },
};
const sessions: IdentitySessionRepository = {
  async findCurrentSession() {
    return {
      user: {
        id: userId,
        organizationId: 'a1000000-0000-4000-8000-000000000001',
        externalSubject: 't',
        displayName: 'T',
        isActive: true,
        dataClassification: 'synthetic',
      },
      organization: {
        id: 'a1000000-0000-4000-8000-000000000001',
        code: 'S',
        name: 'S',
        dataClassification: 'synthetic',
      },
      currentGrants: [],
      resolvedAt: '2026-08-24T00:00:00.000Z',
    };
  },
};
const denied: TerritoryAuthorizationRepository = {
  async findEffectiveGrantsForTarget() {
    return [];
  },
};
const allowed: TerritoryAuthorizationRepository = {
  async findEffectiveGrantsForTarget() {
    return [
      {
        id: 'b3000000-0000-4000-8000-000000000001',
        role: 'regional_director',
        scope: 'territory',
        territoryId,
        coversTargetTerritory: true,
      },
    ];
  },
};
const service = {
  async findPlanTerritory() {
    return territoryId;
  },
  async findSectionTerritory() {
    return territoryId;
  },
} as unknown as PostgresAllocationPlanService;
test('allocation direct identifiers are nonenumerating for unauthorized callers', async () => {
  const app = createApp(async () => {}, false, {
    identityProvider: identity,
    identitySessionRepository: sessions,
    territoryAuthorizationRepository: denied,
    allocationPlanService: service,
  });
  const response = await app.inject({
    method: 'GET',
    url: `/api/v1/allocation-plans/${planId}/history`,
  });
  assert.equal(response.statusCode, 404);
  await app.close();
});
test('allocation routes require authentication before exposing absent direct identifiers', async () => {
  const app = createApp(async () => {}, false, {
    identityProvider: {
      async resolve() {
        return null;
      },
    },
    identitySessionRepository: sessions,
    territoryAuthorizationRepository: denied,
    allocationPlanService: service,
  });
  const response = await app.inject({
    method: 'GET',
    url: `/api/v1/allocation-plans/${planId}/history`,
  });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test('anonymous allocation requests authenticate before validation, lookup, or authorization', async () => {
  let lookups = 0;
  let authorizations = 0;
  const app = createApp(async () => {}, false, {
    identityProvider: {
      async resolve() {
        return null;
      },
    },
    identitySessionRepository: sessions,
    territoryAuthorizationRepository: {
      async findEffectiveGrantsForTarget() {
        authorizations += 1;
        return [];
      },
    },
    allocationPlanService: {
      async findPlanTerritory() {
        lookups += 1;
        return territoryId;
      },
      async findSectionTerritory() {
        lookups += 1;
        return territoryId;
      },
    } as unknown as PostgresAllocationPlanService,
  });
  const requests = [
    { method: 'POST' as const, url: '/api/v1/allocation-plans', payload: {} },
    { method: 'POST' as const, url: '/api/v1/allocation-plans/not-a-uuid/versions', payload: {} },
    {
      method: 'POST' as const,
      url: '/api/v1/allocation-plans/not-a-uuid/versions/nope/request',
      payload: {},
    },
    {
      method: 'POST' as const,
      url: '/api/v1/allocation-plans/not-a-uuid/versions/nope/approve',
      payload: {},
    },
    { method: 'GET' as const, url: '/api/v1/allocation-plans/not-a-uuid/current?effectiveAt=nope' },
    { method: 'GET' as const, url: '/api/v1/allocation-plans/not-a-uuid/history?limit=nope' },
  ];
  for (const request of requests) {
    const response = await app.inject(request);
    assert.equal(response.statusCode, 401, request.url);
    assert.equal(response.json().error.code, 'UNAUTHENTICATED', request.url);
  }
  assert.equal(lookups, 0);
  assert.equal(authorizations, 0);
  await app.close();
});
test('allocation routes reject non-RFC direct identifiers before lookup', async () => {
  const app = createApp(async () => {}, false, {
    identityProvider: identity,
    identitySessionRepository: sessions,
    territoryAuthorizationRepository: allowed,
    allocationPlanService: service,
  });
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/allocation-plans/aaaaaaaa-bbb-ccc-ddd-eeeeeeeeeeee/history',
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, 'VALIDATION_ERROR');
  await app.close();
});
test('inactive sessions are rejected before absent plan or section lookup', async () => {
  const inactive: IdentitySessionRepository = {
    async findCurrentSession() {
      return null;
    },
  };
  const absent = {
    async findPlanTerritory() {
      return null;
    },
    async findSectionTerritory() {
      return null;
    },
  } as unknown as PostgresAllocationPlanService;
  const app = createApp(async () => {}, false, {
    identityProvider: identity,
    identitySessionRepository: inactive,
    territoryAuthorizationRepository: denied,
    allocationPlanService: absent,
  });
  const history = await app.inject({
    method: 'GET',
    url: `/api/v1/allocation-plans/${planId}/history`,
  });
  assert.equal(history.statusCode, 401);
  const create = await app.inject({
    method: 'POST',
    url: '/api/v1/allocation-plans',
    payload: {
      waterSectionId: 'a1000000-0000-4000-8000-000000000001',
      effectiveFrom: '2027-01-01T00:00:00.000000Z',
      reason: 'test',
      entries: [
        {
          intervalStart: '2027-01-01T00:00:00.000000Z',
          intervalEnd: '2027-01-01T01:00:00.000000Z',
          plannedVolume: '0',
          unit: 'm3',
        },
      ],
    },
  });
  assert.equal(create.statusCode, 401);
  await app.close();
});

test('allocation lookup, read, and mutation failures degrade to typed 503 responses', async () => {
  const lookupFailure = {
    async findPlanTerritory() {
      throw new Error('database unavailable');
    },
  } as unknown as PostgresAllocationPlanService;
  const lookupApp = createApp(async () => {}, false, {
    identityProvider: identity,
    identitySessionRepository: sessions,
    territoryAuthorizationRepository: allowed,
    allocationPlanService: lookupFailure,
  });
  const lookup = await lookupApp.inject({
    method: 'GET',
    url: `/api/v1/allocation-plans/${planId}/history`,
  });
  assert.equal(lookup.statusCode, 503);
  assert.equal(lookup.json().error.code, 'UNAVAILABLE');
  await lookupApp.close();

  const operationFailure = {
    async findPlanTerritory() {
      return territoryId;
    },
    async current() {
      throw new Error('database unavailable');
    },
    async append() {
      throw new Error('database unavailable');
    },
  } as unknown as PostgresAllocationPlanService;
  const operationApp = createApp(async () => {}, false, {
    identityProvider: identity,
    identitySessionRepository: sessions,
    territoryAuthorizationRepository: allowed,
    allocationPlanService: operationFailure,
  });
  const read = await operationApp.inject({
    method: 'GET',
    url: `/api/v1/allocation-plans/${planId}/current?effectiveAt=2027-01-01T00%3A00%3A00.000000Z`,
  });
  const mutation = await operationApp.inject({
    method: 'POST',
    url: `/api/v1/allocation-plans/${planId}/versions`,
    payload: {
      effectiveFrom: '2027-01-01T00:00:00.000000Z',
      reason: 'degraded database test',
      entries: [
        {
          intervalStart: '2027-01-01T00:00:00.000000Z',
          intervalEnd: '2027-01-01T01:00:00.000000Z',
          plannedVolume: '1',
          unit: 'm3',
        },
      ],
    },
  });
  for (const response of [read, mutation]) {
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error.code, 'UNAVAILABLE');
  }
  await operationApp.close();
});
