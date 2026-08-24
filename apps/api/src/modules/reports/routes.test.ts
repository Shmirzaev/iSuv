import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { TerritoryAuthorizationRepository } from '../authorization/service.js';
import type { IdentityProvider } from '../identity/provider.js';
import type { IdentitySessionRepository } from '../identity/repository.js';
import { registerReportRoutes } from './routes.js';
import { ReportError, type PostgresReportService } from './service.js';
const ids = {
  user: '12000000-0000-4000-8000-000000000001',
  territory: '12000000-0000-4000-8000-000000000002',
  incident: '12000000-0000-4000-8000-000000000004',
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
test('reports authenticate before strict parsing and nonenumerate denied scope', async () => {
  let generated = 0;
  const service = {
    findDefaultTerritory: async () => ids.territory,
    findIncidentScope: async () => ({ territory_id: ids.territory }),
    findScope: async () => ({ territory_id: ids.territory }),
    generate: async () => {
      generated++;
      return null;
    },
    list: async () => [],
    get: async () => null,
    export: async () => ({ body: '', contentType: 'text/csv' }),
  } as unknown as PostgresReportService;
  const anonymous = Fastify();
  registerReportRoutes(anonymous, {
    identityProvider: { resolve: async () => null } as unknown as IdentityProvider,
    sessionRepository: sessions,
    authorizationRepository: allowed,
    service,
  });
  assert.equal(
    (
      await anonymous.inject({
        method: 'POST',
        url: '/api/v1/reports',
        payload: { kind: 'daily_situation', payload: { forged: true } },
      })
    ).statusCode,
    401,
  );
  await anonymous.close();
  const app = Fastify();
  registerReportRoutes(app, {
    identityProvider: identity,
    sessionRepository: sessions,
    authorizationRepository: allowed,
    service,
  });
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/reports',
        payload: { kind: 'daily_situation', payload: { forged: true } },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (await app.inject({ method: 'POST', url: '/api/v1/reports', payload: { kind: 'incident' } }))
      .statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/reports',
        payload: { kind: 'daily_situation' },
      })
    ).statusCode,
    503,
  );
  assert.equal(generated, 1);
  await app.close();
  const denied = Fastify();
  registerReportRoutes(denied, {
    identityProvider: identity,
    sessionRepository: sessions,
    authorizationRepository: {
      findEffectiveGrantsForTarget: async () => [],
    } as unknown as TerritoryAuthorizationRepository,
    service,
  });
  assert.equal(
    (await denied.inject({ method: 'GET', url: `/api/v1/reports/${ids.incident}` })).statusCode,
    404,
  );
  await denied.close();
});

test('an incident report without a caller territory uses its authorized incident scope', async () => {
  let generatedTerritory: string | null = null;
  const service = {
    findDefaultTerritory: async () => '12000000-0000-4000-8000-000000000099',
    findIncidentScope: async () => ({ territory_id: ids.territory }),
    generate: async (_input: unknown, territoryId: string) => {
      generatedTerritory = territoryId;
      throw new ReportError('NOT_FOUND', 'fixture stops after scope capture');
    },
  } as unknown as PostgresReportService;
  const app = Fastify();
  registerReportRoutes(app, {
    identityProvider: identity,
    sessionRepository: sessions,
    authorizationRepository: allowed,
    service,
  });
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/reports',
    payload: { kind: 'incident', incidentId: ids.incident },
  });
  assert.equal(response.statusCode, 404);
  assert.equal(generatedTerritory, ids.territory);
  await app.close();
});

test('a valid report identifier that is absent is non-enumerating and returns not found', async () => {
  const service = {
    findScope: async () => null,
  } as unknown as PostgresReportService;
  const app = Fastify();
  registerReportRoutes(app, {
    identityProvider: identity,
    sessionRepository: sessions,
    authorizationRepository: allowed,
    service,
  });
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/reports/12000000-0000-4000-8000-000000000005',
  });
  assert.equal(response.statusCode, 404);
  await app.close();
});
