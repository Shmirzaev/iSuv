import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { TerritoryAuthorizationRepository } from '../authorization/service.js';
import type { IdentityProvider } from '../identity/provider.js';
import type { IdentitySessionRepository } from '../identity/repository.js';
import { registerAnalyticsRoutes } from './routes.js';
import type { PostgresAnalyticsService } from './service.js';

const ids = {
  user: '12000000-0000-4000-8000-000000000001',
  territory: '12000000-0000-4000-8000-000000000002',
};
const identity = { resolve: async () => ({ userId: ids.user }) } as unknown as IdentityProvider;
const sessions = {
  findCurrentSession: async () => ({
    user: { id: ids.user, organizationId: '12000000-0000-4000-8000-000000000003' },
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

test('analytics authenticates before parsing, strictly rejects forged fields, and nonenumerates denied scope', async () => {
  let defaults = 0,
    reads = 0;
  const service = {
    findDefaultTerritory: async () => {
      defaults++;
      return ids.territory;
    },
    analytics: async () => {
      reads++;
      return null;
    },
  } as unknown as PostgresAnalyticsService;
  const anonymous = Fastify();
  registerAnalyticsRoutes(anonymous, {
    identityProvider: { resolve: async () => null } as unknown as IdentityProvider,
    sessionRepository: sessions,
    authorizationRepository: allowed,
    service,
  });
  assert.equal(
    (
      await anonymous.inject({
        method: 'GET',
        url: '/api/v1/analytics?facet=section&facetId=not-a-uuid&assetIds=forged',
      })
    ).statusCode,
    401,
  );
  assert.equal(defaults, 0);
  await anonymous.close();
  const app = Fastify();
  registerAnalyticsRoutes(app, {
    identityProvider: identity,
    sessionRepository: sessions,
    authorizationRepository: allowed,
    service,
  });
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/v1/analytics?assetIds=forged' })).statusCode,
    400,
  );
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/v1/analytics?facet=section' })).statusCode,
    400,
  );
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/v1/analytics?period=today' })).statusCode,
    404,
  );
  assert.equal(reads, 1);
  await app.close();
  const denied = Fastify();
  registerAnalyticsRoutes(denied, {
    identityProvider: identity,
    sessionRepository: sessions,
    authorizationRepository: {
      findEffectiveGrantsForTarget: async () => [],
    } as unknown as TerritoryAuthorizationRepository,
    service,
  });
  assert.equal(
    (await denied.inject({ method: 'GET', url: `/api/v1/analytics?territoryId=${ids.territory}` }))
      .statusCode,
    404,
  );
  assert.equal(reads, 1);
  await denied.close();
});
