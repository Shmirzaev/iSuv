import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { IdentityProvider } from '../identity/provider.js';
import type { IdentitySessionRepository } from '../identity/repository.js';
import type { TerritoryAuthorizationRepository } from '../authorization/service.js';
import { registerAlarmIncidentCenterRoutes } from './routes.js';
import type { PostgresAlarmIncidentCenterService } from './service.js';
const ids = {
  user: '12000000-0000-4000-8000-000000000001',
  territory: '12000000-0000-4000-8000-000000000002',
};
const session = {
  findCurrentSession: async () => ({
    user: { id: ids.user, organizationId: '12000000-0000-4000-8000-000000000003' },
  }),
} as unknown as IdentitySessionRepository;
const identity = { resolve: async () => ({ userId: ids.user }) } as unknown as IdentityProvider;
test('center authenticates before parsing and denied territory does not compose', async () => {
  let calls = 0;
  const service = {
    findDefaultTerritory: async () => ids.territory,
    list: async () => {
      calls++;
      return null;
    },
  } as unknown as PostgresAlarmIncidentCenterService;
  const unauth = Fastify();
  registerAlarmIncidentCenterRoutes(unauth, {
    identityProvider: { resolve: async () => null } as unknown as IdentityProvider,
    sessionRepository: session,
    authorizationRepository: {} as TerritoryAuthorizationRepository,
    service,
  });
  assert.equal(
    (await unauth.inject({ method: 'GET', url: '/api/v1/alarm-incident-center?territoryId=wrong' }))
      .statusCode,
    401,
  );
  assert.equal(calls, 0);
  await unauth.close();
  const denied = Fastify();
  registerAlarmIncidentCenterRoutes(denied, {
    identityProvider: identity,
    sessionRepository: session,
    authorizationRepository: {
      findEffectiveGrantsForTarget: async () => [],
    } as unknown as TerritoryAuthorizationRepository,
    service,
  });
  assert.equal(
    (
      await denied.inject({
        method: 'GET',
        url: `/api/v1/alarm-incident-center?territoryId=${ids.territory}`,
      })
    ).statusCode,
    404,
  );
  assert.equal(calls, 0);
  await denied.close();
});
test('center parses strict filters after authorization', async () => {
  const app = Fastify();
  registerAlarmIncidentCenterRoutes(app, {
    identityProvider: identity,
    sessionRepository: session,
    authorizationRepository: {
      findEffectiveGrantsForTarget: async () => [
        {
          id: ids.user,
          role: 'national_admin',
          scope: 'national',
          territoryId: null,
          coversTargetTerritory: true,
        },
      ],
    } as unknown as TerritoryAuthorizationRepository,
    service: {
      findDefaultTerritory: async () => ids.territory,
      list: async () => null,
    } as unknown as PostgresAlarmIncidentCenterService,
  });
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/v1/alarm-incident-center?forged=caller-state' }))
      .statusCode,
    400,
  );
  await app.close();
});
