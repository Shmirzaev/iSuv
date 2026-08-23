import assert from 'node:assert/strict';
import test from 'node:test';
import type { Session, ValidationProfileVersion } from '@isuv/contracts';
import { createApp } from '../../app.js';
import type { TerritoryAuthorizationRepository } from '../authorization/service.js';
import type { IdentityProvider } from '../identity/provider.js';
import type { IdentitySessionRepository } from '../identity/repository.js';
import type { PostgresValidationService } from './service.js';

const userId = 'e3000000-0000-4000-8000-000000000001';
const organizationId = 'e1000000-0000-4000-8000-000000000001';
const territoryId = 'e2000000-0000-4000-8000-000000000001';
const sensorId = 'e5000000-0000-4000-8000-000000000001';
const profileId = 'e4000000-0000-4000-8000-000000000001';
const session: Session = {
  user: {
    id: userId,
    organizationId,
    externalSubject: 'synthetic:validator',
    displayName: 'Validator',
    isActive: true,
    dataClassification: 'synthetic',
  },
  organization: { id: organizationId, code: 'TEST', name: 'Test', dataClassification: 'synthetic' },
  currentGrants: [],
  resolvedAt: '2026-08-23T00:00:00.000000Z',
};
const provider: IdentityProvider = {
  async resolve(request) {
    return request.headers['x-isuv-user-id'] === userId
      ? { userId, provider: 'local-development' }
      : null;
  },
};
const sessions: IdentitySessionRepository = {
  async findCurrentSession(id) {
    return id === userId ? session : null;
  },
};
const version: ValidationProfileVersion = {
  id: 'e6000000-0000-4000-8000-000000000001',
  profileId,
  version: 1,
  organizationId,
  territoryId,
  sensorId,
  measurementKind: 'stage',
  dataClassification: 'synthetic',
  name: 'synthetic test',
  status: 'draft',
  effectiveFrom: '2026-08-23T00:00:00.000000Z',
  effectiveUntil: null,
  rules: { staleAfterSeconds: 60 },
  draftedByUserId: userId,
  draftedAt: '2026-08-23T00:00:00.000000Z',
  approvedByUserId: null,
  approvedAt: null,
  approvalReason: null,
  syntheticNonAuthoritative: true,
};
function repository(allow: boolean): TerritoryAuthorizationRepository {
  return {
    async findEffectiveGrantsForTarget() {
      return allow
        ? [
            {
              id: 'ea000000-0000-4000-8000-000000000001',
              role: 'hydrologist',
              scope: 'territory',
              territoryId,
              coversTargetTerritory: true,
            },
          ]
        : [];
    },
  };
}
test('validation profile API authenticates/authorizes before service calls and keeps denied scope nonenumerable', async () => {
  let calls = 0;
  const service = {
    async createProfile() {
      calls++;
      return version;
    },
    async createVersion() {
      calls++;
      return version;
    },
    async approveVersion() {
      calls++;
      return version;
    },
    async validate() {
      calls++;
      return {
        outcome: 'deferred' as const,
        deferReason: 'no_approved_profile' as const,
        profileVersionId: null,
        profileVersion: null,
        evidence: [],
        observation: null,
        coverageState: 'unconfigured' as const,
        qualityState: null,
      };
    },
  } as unknown as PostgresValidationService;
  const app = createApp(async () => undefined, false, {
    identityProvider: provider,
    identitySessionRepository: sessions,
    territoryAuthorizationRepository: repository(false),
    validationService: service,
  });
  const payload = {
    organizationId,
    territoryId,
    sensorId,
    measurementKind: 'stage',
    dataClassification: 'synthetic',
    name: 'route test',
    effectiveFrom: '2026-08-23T00:00:00.000000Z',
    rules: { staleAfterSeconds: 60 },
    reason: 'test',
  };
  assert.equal(
    (await app.inject({ method: 'POST', url: '/api/v1/validation/profiles', payload })).statusCode,
    401,
  );
  assert.equal(calls, 0);
  const denied = await app.inject({
    method: 'POST',
    url: '/api/v1/validation/profiles',
    headers: { 'x-isuv-user-id': userId },
    payload,
  });
  assert.equal(denied.statusCode, 404);
  assert.equal(calls, 0);
  await app.close();
});
test('validation profile API exposes typed synthetic draft only to dedicated authority', async () => {
  const service = {
    async createProfile() {
      return version;
    },
    async createVersion() {
      return version;
    },
    async approveVersion() {
      return version;
    },
    async validate() {
      return {
        outcome: 'deferred' as const,
        deferReason: 'no_approved_profile' as const,
        profileVersionId: null,
        profileVersion: null,
        evidence: [],
        observation: null,
        coverageState: 'unconfigured' as const,
        qualityState: null,
      };
    },
  } as unknown as PostgresValidationService;
  const app = createApp(async () => undefined, false, {
    identityProvider: provider,
    identitySessionRepository: sessions,
    territoryAuthorizationRepository: repository(true),
    validationService: service,
  });
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/validation/profiles',
    headers: { 'x-isuv-user-id': userId },
    payload: {
      organizationId,
      territoryId,
      sensorId,
      measurementKind: 'stage',
      dataClassification: 'synthetic',
      name: 'route test',
      effectiveFrom: '2026-08-23T00:00:00.000000Z',
      rules: { staleAfterSeconds: 60 },
      reason: 'test',
    },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().profileVersion.syntheticNonAuthoritative, true);
  await app.close();
});
