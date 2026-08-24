import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { TerritoryAuthorizationRepository } from '../authorization/service.js';
import type { IdentityProvider } from '../identity/provider.js';
import type { IdentitySessionRepository } from '../identity/repository.js';
import { registerDashboardRoutes } from './routes.js';
import type { PostgresDashboardService } from './service.js';

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
const authorization = {
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

test('dashboard authenticates before scope lookup and hides denied territory without calling read model', async () => {
  let defaults = 0;
  let dashboards = 0;
  const service = {
    findDefaultTerritory: async () => {
      defaults += 1;
      return ids.territory;
    },
    dashboard: async () => {
      dashboards += 1;
      return null;
    },
  } as unknown as PostgresDashboardService;
  const anonymous = Fastify();
  registerDashboardRoutes(anonymous, {
    identityProvider: { resolve: async () => null } as unknown as IdentityProvider,
    sessionRepository: sessions,
    authorizationRepository: authorization,
    service,
  });
  assert.equal(
    (await anonymous.inject({ method: 'GET', url: '/api/v1/dashboard?period=today' })).statusCode,
    401,
  );
  assert.equal(
    (
      await anonymous.inject({
        method: 'GET',
        url: '/api/v1/dashboard?territoryId=not-a-uuid&sensorIds=forged',
      })
    ).statusCode,
    401,
    'anonymous callers cannot distinguish malformed requested scope from a valid one',
  );
  assert.equal(defaults, 0);
  await anonymous.close();
  const denied = Fastify();
  registerDashboardRoutes(denied, {
    identityProvider: identity,
    sessionRepository: sessions,
    authorizationRepository: {
      findEffectiveGrantsForTarget: async () => [],
    } as unknown as TerritoryAuthorizationRepository,
    service,
  });
  assert.equal(
    (await denied.inject({ method: 'GET', url: `/api/v1/dashboard?territoryId=${ids.territory}` }))
      .statusCode,
    404,
  );
  assert.equal(dashboards, 0);
  await denied.close();
});

test('dashboard rejects forged client state and returns typed degraded dependency failures', async () => {
  const app = Fastify();
  registerDashboardRoutes(app, {
    identityProvider: identity,
    sessionRepository: sessions,
    authorizationRepository: authorization,
    service: {
      findDefaultTerritory: async () => {
        throw new Error('down');
      },
      dashboard: async () => null,
    } as unknown as PostgresDashboardService,
  });
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/v1/dashboard?sensorIds=x' })).statusCode,
    400,
  );
  const unavailable = await app.inject({ method: 'GET', url: '/api/v1/dashboard' });
  assert.equal(unavailable.statusCode, 503);
  assert.equal(unavailable.json().error.code, 'UNAVAILABLE');
  await app.close();
});

test('dashboard permits district telemetry readers only in their own territory scope', async () => {
  let reads = 0;
  const app = Fastify();
  registerDashboardRoutes(app, {
    identityProvider: identity,
    sessionRepository: sessions,
    authorizationRepository: {
      findEffectiveGrantsForTarget: async (_user: string, territory: string) => [
        {
          id: ids.user,
          role: 'district_operator',
          scope: 'territory',
          territoryId: ids.territory,
          coversTargetTerritory: territory === ids.territory,
        },
      ],
    } as unknown as TerritoryAuthorizationRepository,
    service: {
      findDefaultTerritory: async () => ids.territory,
      dashboard: async () => {
        reads += 1;
        return null;
      },
    } as unknown as PostgresDashboardService,
  });
  assert.equal(
    (await app.inject({ method: 'GET', url: `/api/v1/dashboard?territoryId=${ids.territory}` }))
      .statusCode,
    404,
  );
  assert.equal(reads, 1, 'same-scope request reaches the read model');
  assert.equal(
    (
      await app.inject({
        method: 'GET',
        url: '/api/v1/dashboard?territoryId=12000000-0000-4000-8000-000000000004',
      })
    ).statusCode,
    404,
  );
  assert.equal(reads, 1, 'cross-scope request is nonenumerating and cannot read');
  await app.close();
});
