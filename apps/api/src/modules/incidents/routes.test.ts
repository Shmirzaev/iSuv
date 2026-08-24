import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { TerritoryAuthorizationRepository } from '../authorization/service.js';
import type { IdentityProvider } from '../identity/provider.js';
import type { IdentitySessionRepository } from '../identity/repository.js';
import { registerIncidentRoutes } from './routes.js';
import type { PostgresIncidentService } from './service.js';

const ids = {
  user: '12000000-0000-4000-8000-000000000001',
  territory: '12000000-0000-4000-8000-000000000002',
  policy: '12000000-0000-4000-8000-000000000003',
  alarm: '12000000-0000-4000-8000-000000000004',
  incident: '12000000-0000-4000-8000-000000000005',
  grant: '12000000-0000-4000-8000-000000000006',
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
const version = {
  effectiveFrom: '2030-01-01T00:00:00.000000Z',
  effectiveUntil: '2030-01-02T00:00:00.000000Z',
  tier: 1,
  procedure: 'Synthetic response procedure',
  acknowledgementTargetMicroseconds: '1000000',
  resolutionTargetMicroseconds: '2000000',
  reason: 'Synthetic policy fixture',
};

test('incident routes reject malformed identifiers and caller-authored state before lookup', async () => {
  let lookups = 0;
  const app = Fastify();
  registerIncidentRoutes(app, {
    identityProvider: identity,
    sessionRepository: sessions,
    authorizationRepository: allowed,
    service: {
      findIncidentScope: async () => {
        lookups += 1;
        return null;
      },
    } as unknown as PostgresIncidentService,
  });
  const malformed = await app.inject({
    method: 'POST',
    url: '/api/v1/incidents/not-an-id/acknowledge',
    payload: { reason: 'acknowledge' },
  });
  const forged = await app.inject({
    method: 'POST',
    url: '/api/v1/incidents',
    payload: {
      alarmId: ids.alarm,
      reason: 'open',
      status: 'closed',
      acknowledgedAt: '2030-01-01T00:00:00Z',
    },
  });
  const unsafeVersion = await app.inject({
    method: 'POST',
    url: `/api/v1/escalation-policies/${ids.policy}/versions/request`,
    payload: { ...version, acknowledgementTargetMicroseconds: '0' },
  });
  assert.deepEqual(
    [malformed.statusCode, forged.statusCode, unsafeVersion.statusCode],
    [400, 400, 400],
  );
  assert.equal(lookups, 0);
  await app.close();
});

test('incident mutations authenticate before lookup and denied scope never mutates', async () => {
  let lookups = 0;
  let mutations = 0;
  const service = {
    findAlarmScope: async () => {
      lookups += 1;
      return { territory_id: ids.territory };
    },
    createIncident: async () => {
      mutations += 1;
      throw new Error('must not run');
    },
  } as unknown as PostgresIncidentService;
  const anonymous = Fastify();
  registerIncidentRoutes(anonymous, {
    identityProvider: { resolve: async () => null },
    sessionRepository: sessions,
    authorizationRepository: allowed,
    service,
  });
  assert.equal(
    (
      await anonymous.inject({
        method: 'POST',
        url: '/api/v1/incidents',
        payload: { alarmId: ids.alarm, reason: 'open synthetic case' },
      })
    ).statusCode,
    401,
  );
  assert.equal(lookups, 0);
  await anonymous.close();

  const denied = Fastify();
  registerIncidentRoutes(denied, {
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
        method: 'POST',
        url: '/api/v1/incidents',
        payload: { alarmId: ids.alarm, reason: 'open synthetic case' },
      })
    ).statusCode,
    404,
  );
  assert.equal(lookups, 1);
  assert.equal(mutations, 0);
  await denied.close();
});

test('incident identity, policy, lifecycle, and read dependencies fail as typed 503', async () => {
  const down = async () => {
    throw new Error('down');
  };
  const service = {
    findTerritory: async () => ({ id: ids.territory, organization_id: ids.user }),
    findPolicyScope: async () => ({ territory_id: ids.territory }),
    findAlarmScope: async () => ({ territory_id: ids.territory }),
    findIncidentScope: async () => ({ territory_id: ids.territory }),
    createPolicy: down,
    requestPolicyVersion: down,
    approvePolicyVersion: down,
    createIncident: down,
    action: down,
    getIncident: down,
  } as unknown as PostgresIncidentService;
  const app = Fastify();
  registerIncidentRoutes(app, {
    identityProvider: identity,
    sessionRepository: sessions,
    authorizationRepository: allowed,
    service,
  });
  const responses = [
    await app.inject({
      method: 'POST',
      url: '/api/v1/escalation-policies',
      payload: {
        territoryId: ids.territory,
        eventType: 'high_stage',
        severity: 'warning',
        title: 'Synthetic response policy',
        provenance: 'synthetic:incident-route-test',
        reason: 'create policy',
      },
    }),
    await app.inject({
      method: 'POST',
      url: `/api/v1/escalation-policies/${ids.policy}/versions/request`,
      payload: version,
    }),
    await app.inject({
      method: 'POST',
      url: `/api/v1/escalation-policies/${ids.policy}/versions/1/approve`,
      payload: { reason: 'approve policy' },
    }),
    await app.inject({
      method: 'POST',
      url: '/api/v1/incidents',
      payload: { alarmId: ids.alarm, reason: 'open incident' },
    }),
    await app.inject({
      method: 'POST',
      url: `/api/v1/incidents/${ids.incident}/acknowledge`,
      payload: { reason: 'acknowledge' },
    }),
    await app.inject({
      method: 'GET',
      url: `/api/v1/incidents/${ids.incident}?evaluatedAt=2030-01-01T00:00:00Z`,
    }),
  ];
  assert.deepEqual(
    responses.map((response) => response.statusCode),
    [503, 503, 503, 503, 503, 503],
  );
  await app.close();

  const identityDown = Fastify();
  registerIncidentRoutes(identityDown, {
    identityProvider: { resolve: down } as unknown as IdentityProvider,
    sessionRepository: sessions,
    authorizationRepository: allowed,
    service,
  });
  assert.equal(
    (
      await identityDown.inject({
        method: 'POST',
        url: '/api/v1/incidents',
        payload: { alarmId: ids.alarm, reason: 'open incident' },
      })
    ).statusCode,
    503,
  );
  await identityDown.close();
});
