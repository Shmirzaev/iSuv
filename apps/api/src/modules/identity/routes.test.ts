import assert from 'node:assert/strict';
import test from 'node:test';
import type { Session } from '@isuv/contracts';
import { createApp } from '../../app.js';
import { createLocalDevelopmentIdentityProvider, type IdentityProvider } from './provider.js';
import type { IdentitySessionRepository } from './repository.js';

const userId = 'a3000000-0000-4000-8000-000000000005';
const session: Session = {
  user: {
    id: userId,
    organizationId: 'a1000000-0000-4000-8000-000000000001',
    externalSubject: 'synthetic:district-operator',
    displayName: 'Synthetic district operator',
    isActive: true,
    dataClassification: 'synthetic',
  },
  organization: {
    id: 'a1000000-0000-4000-8000-000000000001',
    code: 'UZ-WATER-SYNTH',
    name: 'Synthetic Uzbekistan Water Authority',
    dataClassification: 'synthetic',
  },
  currentGrants: [
    {
      id: 'a4000000-0000-4000-8000-000000000005',
      userId,
      organizationId: 'a1000000-0000-4000-8000-000000000001',
      role: 'district_operator',
      scope: 'territory',
      territoryId: 'a2000000-0000-4000-8000-000000000004',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      effectiveUntil: null,
    },
  ],
  resolvedAt: '2026-08-23T00:00:00.000Z',
};

const repository: IdentitySessionRepository = {
  async findCurrentSession(id): Promise<Session | null> {
    return id === userId ? session : null;
  },
};

test('local development identity is explicitly enabled and the session route exposes current grants', async () => {
  const app = createApp(async () => undefined, false, {
    identityProvider: createLocalDevelopmentIdentityProvider({ enabled: true }),
    identitySessionRepository: repository,
  });
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/session/current-grants',
    headers: { 'x-isuv-user-id': userId },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().currentGrants[0].role, 'district_operator');
  await app.close();
});

test('the production-default local adapter fails closed even when the request supplies a user header', async () => {
  const app = createApp(async () => undefined, false, { identitySessionRepository: repository });
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/session',
    headers: { 'x-isuv-user-id': userId },
  });
  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, 'UNAUTHENTICATED');
  await app.close();
});

test('an unknown resolved identity is unauthenticated', async () => {
  const identityProvider: IdentityProvider = {
    async resolve() {
      return { userId: 'a3000000-0000-4000-8000-000000000009', provider: 'local-development' };
    },
  };
  const app = createApp(async () => undefined, false, {
    identityProvider,
    identitySessionRepository: repository,
  });
  const response = await app.inject({ method: 'GET', url: '/api/v1/session' });
  assert.equal(response.statusCode, 401);
  await app.close();
});
