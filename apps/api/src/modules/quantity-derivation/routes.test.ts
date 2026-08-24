import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { createApp } from '../../app.js';
import type { IdentityProvider } from '../identity/provider.js';
import type { IdentitySessionRepository } from '../identity/repository.js';
import type { TerritoryAuthorizationRepository } from '../authorization/service.js';
import type { PostgresQuantityDerivationService } from './service.js';
import { registerQuantityDerivationRoutes } from './routes.js';
const userId = 'a3000000-0000-4000-8000-000000000001',
  territoryId = 'a2000000-0000-4000-8000-000000000004',
  stationId = 'b1000000-0000-4000-8000-000000000001',
  curveId = 'b1000000-0000-4000-8000-000000000002',
  sensorId = 'b1000000-0000-4000-8000-000000000006';
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
        externalSubject: 'test',
        displayName: 'Test',
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
      resolvedAt: '2026-01-01T00:00:00.000000Z',
    };
  },
};
const allowed: TerritoryAuthorizationRepository = {
  async findEffectiveGrantsForTarget() {
    return [
      {
        id: 'a4000000-0000-4000-8000-000000000001',
        role: 'regional_director',
        scope: 'territory',
        territoryId,
        coversTargetTerritory: true,
      },
    ];
  },
};
const denied: TerritoryAuthorizationRepository = {
  async findEffectiveGrantsForTarget() {
    return [];
  },
};
function service() {
  return {
    async findStationTerritory() {
      return territoryId;
    },
    async findRatingCurve() {
      return {
        id: 'b1000000-0000-4000-8000-000000000003',
        curveId,
        version: 1,
        organizationId: 'a1000000-0000-4000-8000-000000000001',
        territoryId,
        stationId,
        stageSensorId: 'b1000000-0000-4000-8000-000000000004',
        deviceInstallationId: 'b1000000-0000-4000-8000-000000000005',
        effectiveFrom: '2026-01-01T00:00:00.000000Z',
        effectiveUntil: null,
        knownAt: '2026-01-01T00:00:00.000000Z',
        knots: [
          { stageM: '0', dischargeM3s: '0' },
          { stageM: '1', dischargeM3s: '2' },
        ],
        algorithm: 'synthetic_piecewise_linear_v1',
        hydraulicAssumptions: 'stationary_single_valued_no_hysteresis',
        provenance: 'synthetic:test',
        dataClassification: 'synthetic',
        officialComplianceEligible: false,
      };
    },
    async derive() {
      return {
        outcome: 'deferred',
        deferReason: 'missing_exact_endpoint',
        volume: null,
        measurementKind: 'interval_volume',
        unit: 'm3',
        requestedInterval: {
          start: '2026-01-01T00:00:00.000000Z',
          end: '2026-01-01T01:00:00.000000Z',
        },
        coveredInterval: null,
        coverage: 'no_data',
        knownAt: '2026-01-01T00:00:00.000000Z',
        method: 'direct_discharge',
        policyVersionId: null,
        curveVersionId: null,
        sourceRefs: [],
        provenance: 'synthetic:test',
        dataClassification: 'synthetic',
        officialComplianceEligible: false,
        qualityState: 'no_data',
        uncertainty: null,
      };
    },
  } as unknown as PostgresQuantityDerivationService;
}
test('quantity derivation reads are auth-first, territory nonenumerating, and typed', async () => {
  const app = createApp(async () => {}, false, {
    identityProvider: identity,
    identitySessionRepository: sessions,
    territoryAuthorizationRepository: allowed,
    quantityDerivationService: service(),
  });
  const ok = await app.inject({
    method: 'GET',
    url: `/api/v1/stations/${stationId}/derived-volume?sensorId=${sensorId}&method=direct_discharge&intervalStart=2026-01-01T00%3A00%3A00.000000Z&intervalEnd=2026-01-01T01%3A00%3A00.000000Z`,
  });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().result.outcome, 'deferred');
  const malformed = await app.inject({
    method: 'GET',
    url: '/api/v1/stations/not-a-uuid/derived-volume',
  });
  assert.equal(malformed.statusCode, 400);
  await app.close();
  const forbidden = createApp(async () => {}, false, {
    identityProvider: identity,
    identitySessionRepository: sessions,
    territoryAuthorizationRepository: denied,
    quantityDerivationService: service(),
  });
  const response = await forbidden.inject({
    method: 'GET',
    url: `/api/v1/stations/${stationId}/derived-volume?sensorId=${sensorId}&method=direct_discharge&intervalStart=2026-01-01T00%3A00%3A00.000000Z&intervalEnd=2026-01-01T01%3A00%3A00.000000Z`,
  });
  assert.equal(response.statusCode, 404);
  await forbidden.close();
});
test('quantity derivation degrades as unavailable rather than fabricating a volume', async () => {
  const unavailable = {
    ...service(),
    async findStationTerritory() {
      throw new Error('database unavailable');
    },
  } as unknown as PostgresQuantityDerivationService;
  const app = createApp(async () => {}, false, {
    identityProvider: identity,
    identitySessionRepository: sessions,
    territoryAuthorizationRepository: allowed,
    quantityDerivationService: unavailable,
  });
  const response = await app.inject({
    method: 'GET',
    url: `/api/v1/stations/${stationId}/derived-volume?sensorId=${sensorId}&method=direct_discharge&intervalStart=2026-01-01T00%3A00%3A00.000000Z&intervalEnd=2026-01-01T01%3A00%3A00.000000Z`,
  });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().error.code, 'UNAVAILABLE');
  await app.close();
});

test('quantity derivation routes authenticate before parsing malformed input or resolving a resource', async () => {
  let identityCalls = 0;
  let sessionCalls = 0;
  let serviceCalls = 0;
  let authorizationCalls = 0;
  const app = Fastify();
  registerQuantityDerivationRoutes(app, {
    identityProvider: {
      async resolve() {
        identityCalls += 1;
        return null;
      },
    },
    sessionRepository: {
      async findCurrentSession() {
        sessionCalls += 1;
        return null;
      },
    } as IdentitySessionRepository,
    authorizationRepository: new Proxy(
      {},
      {
        get() {
          authorizationCalls += 1;
          return async () => [];
        },
      },
    ) as TerritoryAuthorizationRepository,
    service: new Proxy(
      {},
      {
        get() {
          serviceCalls += 1;
          return async () => null;
        },
      },
    ) as PostgresQuantityDerivationService,
  });
  const responses = await Promise.all([
    app.inject({ method: 'GET', url: '/api/v1/stations/not-a-uuid/derived-volume?bad=true' }),
    app.inject({ method: 'GET', url: '/api/v1/rating-curves/not-a-uuid?bad=true' }),
  ]);
  assert.equal(identityCalls, 2);
  assert.equal(sessionCalls, 0);
  assert.equal(serviceCalls, 0);
  assert.equal(authorizationCalls, 0);
  for (const response of responses) {
    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json().error, {
      code: 'UNAUTHENTICATED',
      message: 'Authentication is required.',
      requestId: response.json().error.requestId,
    });
  }
  await app.close();
});
