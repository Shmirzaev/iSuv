import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { IdentityProvider } from '../identity/provider.js';
import type { IdentitySessionRepository } from '../identity/repository.js';
import type { TerritoryAuthorizationRepository } from '../authorization/service.js';
import { registerMapNetworkRoutes } from './routes.js';
import type { PostgresMapNetworkService } from './service.js';

const ids = {
  user: '12000000-0000-4000-8000-000000000001',
  territory: '12000000-0000-4000-8000-000000000002',
  station: '12000000-0000-4000-8000-000000000003',
};
const sessions = {
  findCurrentSession: async () => ({
    user: { id: ids.user, organizationId: '12000000-0000-4000-8000-000000000004' },
  }),
} as unknown as IdentitySessionRepository;
const authorized = {
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
const identity = { resolve: async () => ({ userId: ids.user }) } as unknown as IdentityProvider;

test('map authenticates before parsing and hides denied territories', async () => {
  let calls = 0;
  const service = {
    findDefaultTerritory: async () => ids.territory,
    map: async () => {
      calls += 1;
      return null;
    },
    trace: async () => null,
    playback: async () => null,
  } as unknown as PostgresMapNetworkService;
  const unauthenticated = Fastify();
  registerMapNetworkRoutes(unauthenticated, {
    identityProvider: { resolve: async () => null } as unknown as IdentityProvider,
    sessionRepository: sessions,
    authorizationRepository: authorized,
    service,
  });
  assert.equal(
    (await unauthenticated.inject({ method: 'GET', url: '/api/v1/map-network?territoryId=bad' }))
      .statusCode,
    401,
  );
  assert.equal(calls, 0);
  await unauthenticated.close();

  const denied = Fastify();
  registerMapNetworkRoutes(denied, {
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
        url: `/api/v1/map-network?territoryId=${ids.territory}`,
      })
    ).statusCode,
    404,
  );
  assert.equal(calls, 0);
  await denied.close();
});

test('map, trace, and playback parse strict queries only after authentication', async () => {
  const app = Fastify();
  registerMapNetworkRoutes(app, {
    identityProvider: identity,
    sessionRepository: sessions,
    authorizationRepository: authorized,
    service: {
      findDefaultTerritory: async () => ids.territory,
      map: async () => null,
      trace: async () => null,
      playback: async () => null,
    } as unknown as PostgresMapNetworkService,
  });
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/v1/map-network?stations=forged' })).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: 'GET',
        url: `/api/v1/map-network/trace?stationId=${ids.station}&graph=x`,
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: 'GET',
        url: `/api/v1/map-network/playback?stationId=${ids.station}&frame=1`,
      })
    ).statusCode,
    400,
  );
  await app.close();
});
