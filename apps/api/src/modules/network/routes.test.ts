import assert from 'node:assert/strict';
import test from 'node:test';
import type { NetworkEntity, Session } from '@isuv/contracts';
import { createApp } from '../../app.js';
import type { TerritoryAuthorizationRepository } from '../authorization/service.js';
import type { IdentityProvider } from '../identity/provider.js';
import type { IdentitySessionRepository } from '../identity/repository.js';
import type { NetworkReadRepository } from './repository.js';

const organizationId = 'c1000000-0000-4000-8000-000000000001';
const districtA = 'c2000000-0000-4000-8000-000000000001';
const districtB = 'c2000000-0000-4000-8000-000000000002';
const districtUser = 'c3000000-0000-4000-8000-000000000001';
const directorUser = 'c3000000-0000-4000-8000-000000000002';

function session(userId: string): Session {
  return {
    user: {
      id: userId,
      organizationId,
      externalSubject: `synthetic:${userId}`,
      displayName: 'Synthetic network reader',
      isActive: true,
      dataClassification: 'synthetic',
    },
    organization: {
      id: organizationId,
      code: 'NETWORK-TEST',
      name: 'Synthetic network test authority',
      dataClassification: 'synthetic',
    },
    currentGrants: [],
    resolvedAt: '2026-08-23T00:00:00.000Z',
  };
}

const junction: NetworkEntity = {
  type: 'junction',
  id: 'c4000000-0000-4000-8000-000000000001',
  organizationId,
  territoryId: districtA,
  code: 'JUNCTION-A',
  name: 'Synthetic junction A',
  lifecycle: 'active',
  status: 'operational',
  dataClassification: 'synthetic',
  revision: 1,
  geometry: { type: 'Point', coordinates: [69.2, 41.3] },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const hiddenJunction: NetworkEntity = {
  ...junction,
  id: 'c4000000-0000-4000-8000-000000000002',
  territoryId: districtB,
  code: 'JUNCTION-B',
};

const identityProvider: IdentityProvider = {
  async resolve(request) {
    const candidate = request.headers['x-isuv-user-id'];
    const userId = Array.isArray(candidate) ? candidate[0] : candidate;
    return userId ? { userId, provider: 'local-development' } : null;
  },
};

const sessionRepository: IdentitySessionRepository = {
  async findCurrentSession(userId) {
    if (userId !== districtUser && userId !== directorUser) return null;
    return session(userId);
  },
};

const authorizationRepository: TerritoryAuthorizationRepository = {
  async findEffectiveGrantsForTarget(userId, targetTerritoryId) {
    if (userId === districtUser) {
      return [
        {
          id: 'c5000000-0000-4000-8000-000000000001',
          role: 'district_operator',
          scope: 'territory',
          territoryId: districtA,
          coversTargetTerritory: targetTerritoryId === districtA,
        },
      ];
    }
    return [
      {
        id: 'c5000000-0000-4000-8000-000000000002',
        role: 'regional_director',
        scope: 'territory',
        territoryId: 'c2000000-0000-4000-8000-000000000099',
        coversTargetTerritory: targetTerritoryId === districtA || targetTerritoryId === districtB,
      },
    ];
  },
};

const networkRepository: NetworkReadRepository = {
  async listEntities(_type, territoryId) {
    return territoryId === districtA ? [junction] : [];
  },
  async findEntity(_type, id) {
    if (id === junction.id) return junction;
    if (id === hiddenJunction.id) return hiddenJunction;
    return null;
  },
  async listTopology() {
    return [];
  },
};

function createNetworkTestApp() {
  return createApp(async () => undefined, false, {
    identityProvider,
    identitySessionRepository: sessionRepository,
    territoryAuthorizationRepository: authorizationRepository,
    networkReadRepository: networkRepository,
  });
}

test('network list permits same-territory and ancestor-territory telemetry readers', async () => {
  const app = createNetworkTestApp();
  const sameTerritory = await app.inject({
    method: 'GET',
    url: `/api/v1/network/entities/junction?territoryId=${districtA}`,
    headers: { 'x-isuv-user-id': districtUser },
  });
  assert.equal(sameTerritory.statusCode, 200);
  assert.equal(sameTerritory.json().entities[0].type, 'junction');

  const ancestorTerritory = await app.inject({
    method: 'GET',
    url: `/api/v1/network/topology?territoryId=${districtB}`,
    headers: { 'x-isuv-user-id': directorUser },
  });
  assert.equal(ancestorTerritory.statusCode, 200);
  await app.close();
});

test('network read fails closed for cross-territory, inactive, and unknown identities', async () => {
  const app = createNetworkTestApp();
  const crossTerritory = await app.inject({
    method: 'GET',
    url: `/api/v1/network/entities/junction?territoryId=${districtB}`,
    headers: { 'x-isuv-user-id': districtUser },
  });
  assert.equal(crossTerritory.statusCode, 403);

  const hiddenDetail = await app.inject({
    method: 'GET',
    url: `/api/v1/network/entities/junction/${hiddenJunction.id}`,
    headers: { 'x-isuv-user-id': districtUser },
  });
  assert.equal(hiddenDetail.statusCode, 404);
  assert.equal('entity' in hiddenDetail.json(), false);

  const unknownDetail = await app.inject({
    method: 'GET',
    url: '/api/v1/network/entities/junction/c4000000-0000-4000-8000-000000000099',
    headers: { 'x-isuv-user-id': districtUser },
  });
  assert.equal(unknownDetail.statusCode, 404);
  assert.deepEqual(
    { code: hiddenDetail.json().error.code, message: hiddenDetail.json().error.message },
    { code: unknownDetail.json().error.code, message: unknownDetail.json().error.message },
  );

  const inactive = await app.inject({
    method: 'GET',
    url: `/api/v1/network/entities/junction?territoryId=${districtA}`,
    headers: { 'x-isuv-user-id': 'c3000000-0000-4000-8000-000000000003' },
  });
  assert.equal(inactive.statusCode, 401);

  const unknown = await app.inject({
    method: 'GET',
    url: `/api/v1/network/entities/junction?territoryId=${districtA}`,
    headers: { 'x-isuv-user-id': 'c3000000-0000-4000-8000-000000000004' },
  });
  assert.equal(unknown.statusCode, 401);
  await app.close();
});

test('the API has no physical-control command route', async () => {
  const app = createNetworkTestApp();
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/control-structures/c4000000-0000-4000-8000-000000000001/commands',
    headers: { 'x-isuv-user-id': districtUser },
  });
  assert.equal(response.statusCode, 404);
  await app.close();
});
