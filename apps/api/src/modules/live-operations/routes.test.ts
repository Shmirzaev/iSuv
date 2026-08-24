import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { TerritoryAuthorizationRepository } from '../authorization/service.js';
import type { IdentityProvider } from '../identity/provider.js';
import type { IdentitySessionRepository } from '../identity/repository.js';
import { registerLiveOperationsRoutes } from './routes.js';
import type { PostgresLiveOperationsService } from './service.js';

const ids = {
  user: '12000000-0000-4000-8000-000000000001',
  territory: '12000000-0000-4000-8000-000000000002',
  childTerritory: '12000000-0000-4000-8000-000000000003',
  device: '12000000-0000-4000-8000-000000000004',
  organization: '12000000-0000-4000-8000-000000000005',
  unknownDevice: '12000000-0000-4000-8000-000000000006',
};
const identity = { resolve: async () => ({ userId: ids.user }) } as unknown as IdentityProvider;
const sessions = {
  findCurrentSession: async () => ({
    user: { id: ids.user, organizationId: ids.organization },
  }),
} as unknown as IdentitySessionRepository;
const allowed = {
  findEffectiveGrantsForTarget: async () => [
    {
      id: ids.user,
      role: 'national_admin',
      scope: 'national',
      territoryId: null,
      coversTargetTerritory: true,
    },
  ],
} as unknown as TerritoryAuthorizationRepository;

test('live operations authenticates before filters and nonenumerates denied scope', async () => {
  let called = 0;
  const service = {
    findDefaultTerritory: async () => ids.territory,
    list: async () => {
      called += 1;
      return null;
    },
    inspector: async () => {
      called += 1;
      return null;
    },
    descendantTerritoryIds: async () => {
      called += 1;
      return [];
    },
    live: async () => {
      called += 1;
      return { reset: false, events: [] };
    },
  } as unknown as PostgresLiveOperationsService;
  const anonymous = Fastify();
  registerLiveOperationsRoutes(anonymous, {
    identityProvider: { resolve: async () => null } as unknown as IdentityProvider,
    sessionRepository: sessions,
    authorizationRepository: allowed,
    service,
  });
  assert.equal(
    (await anonymous.inject({ method: 'GET', url: '/api/v1/live-operations?deviceId=forged' }))
      .statusCode,
    401,
  );
  const malformedAnonymous = await Promise.all([
    anonymous.inject({ method: 'GET', url: '/api/v1/live-operations?sensorIds=forged' }),
    anonymous.inject({ method: 'GET', url: '/api/v1/live-operations/not-a-uuid?limit=invalid' }),
    anonymous.inject({
      method: 'GET',
      url: '/api/v1/live-operations/live?territoryId=not-a-uuid',
      headers: { 'last-event-id': 'bad' },
    }),
  ]);
  for (const response of malformedAnonymous) {
    assert.equal(response.statusCode, 401);
    assert.deepEqual(
      { code: response.json().error.code, message: response.json().error.message },
      { code: 'UNAUTHENTICATED', message: 'Authentication is required.' },
    );
  }
  assert.equal(called, 0);
  await anonymous.close();

  const denied = Fastify();
  registerLiveOperationsRoutes(denied, {
    identityProvider: identity,
    sessionRepository: sessions,
    authorizationRepository: {
      findEffectiveGrantsForTarget: async () => [],
    } as unknown as TerritoryAuthorizationRepository,
    service,
  });
  assert.equal(
    (
      await denied.inject({
        method: 'GET',
        url: `/api/v1/live-operations?territoryId=${ids.territory}`,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await denied.inject({
        method: 'GET',
        url: `/api/v1/live-operations/${ids.device}?territoryId=${ids.territory}`,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await denied.inject({
        method: 'GET',
        url: `/api/v1/live-operations/live?territoryId=${ids.territory}`,
      })
    ).statusCode,
    404,
  );
  assert.equal(called, 0);
  await denied.close();
});

test('inspector uses the same nonenumerating response for foreign and unknown devices', async () => {
  let calls = 0;
  const app = Fastify();
  registerLiveOperationsRoutes(app, {
    identityProvider: identity,
    sessionRepository: sessions,
    authorizationRepository: allowed,
    service: {
      findDefaultTerritory: async () => ids.territory,
      inspector: async () => {
        calls += 1;
        return null;
      },
    } as unknown as PostgresLiveOperationsService,
  });
  const foreign = await app.inject({
    method: 'GET',
    url: `/api/v1/live-operations/${ids.device}?territoryId=${ids.territory}`,
  });
  const unknown = await app.inject({
    method: 'GET',
    url: `/api/v1/live-operations/${ids.unknownDevice}?territoryId=${ids.territory}`,
  });
  assert.equal(foreign.statusCode, 404);
  assert.equal(unknown.statusCode, 404);
  const foreignError = foreign.json().error as { code: string; message: string };
  const unknownError = unknown.json().error as { code: string; message: string };
  assert.deepEqual(
    { code: foreignError.code, message: foreignError.message },
    { code: unknownError.code, message: unknownError.message },
  );
  assert.equal(calls, 2);
  await app.close();
});

test('live operations rejects caller asset lists and malformed SSE cursors', async () => {
  const app = Fastify();
  registerLiveOperationsRoutes(app, {
    identityProvider: identity,
    sessionRepository: sessions,
    authorizationRepository: allowed,
    service: {
      findDefaultTerritory: async () => ids.territory,
      list: async () => null,
      inspector: async () => null,
    } as unknown as PostgresLiveOperationsService,
  });
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/v1/live-operations?sensorIds=forged' }))
      .statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: 'GET',
        url: '/api/v1/live-operations/live',
        headers: { 'last-event-id': 'bad' },
      })
    ).statusCode,
    400,
  );
  await app.close();
});

test('scope-safe live feed reuses descendant journal invalidations and cursor', async () => {
  let after: bigint | null = null;
  let territories: string[] = [];
  const app = Fastify();
  registerLiveOperationsRoutes(app, {
    identityProvider: identity,
    sessionRepository: sessions,
    authorizationRepository: allowed,
    service: {
      findDefaultTerritory: async () => ids.territory,
      list: async () => ({ rows: [] }),
      descendantTerritoryIds: async () => [ids.territory, ids.childTerritory],
      live: async (_organization: string, value: bigint | null, values: string[]) => {
        after = value;
        territories = values;
        return {
          reset: false,
          events: [{ id: '13', event: { deviceId: ids.device } }],
        };
      },
    } as unknown as PostgresLiveOperationsService,
  });
  const response = await app.inject({
    method: 'GET',
    url: `/api/v1/live-operations/live?territoryId=${ids.territory}`,
    headers: { 'last-event-id': '12' },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(after, 12n);
  assert.deepEqual(territories, [ids.territory, ids.childTerritory]);
  assert.match(response.body, /id: 13/);
  assert.match(response.body, /event: invalidate/);
  assert.match(response.body, /: heartbeat/);
  await app.close();
});
