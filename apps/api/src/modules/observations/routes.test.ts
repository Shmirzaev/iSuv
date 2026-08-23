import assert from 'node:assert/strict';
import test from 'node:test';
import type { Observation, Session } from '@isuv/contracts';
import { createApp } from '../../app.js';
import type { TerritoryAuthorizationRepository } from '../authorization/service.js';
import type { IdentityProvider } from '../identity/provider.js';
import type { IdentitySessionRepository } from '../identity/repository.js';
import type { PostgresObservationService } from './service.js';

const organizationId = 'e1000000-0000-4000-8000-000000000001';
const territoryA = 'e2000000-0000-4000-8000-000000000001';
const territoryB = 'e2000000-0000-4000-8000-000000000002';
const userId = 'e3000000-0000-4000-8000-000000000001';
const lineageId = 'e4000000-0000-4000-8000-000000000001';
const sensorId = 'e5000000-0000-4000-8000-000000000001';
const observation: Observation = {
  id: 'e6000000-0000-4000-8000-000000000001',
  lineageId,
  revision: 1,
  organizationId,
  territoryId: territoryA,
  stationId: 'e7000000-0000-4000-8000-000000000001',
  sensorId,
  deviceId: 'e8000000-0000-4000-8000-000000000001',
  deviceInstallationId: 'e9000000-0000-4000-8000-000000000001',
  measurementKind: 'stage',
  unit: 'm',
  sourceSystem: 'test-adapter',
  sourceEventId: 'event-1',
  observedAt: '2026-08-23T00:00:00.000Z',
  ingestedAt: '2026-08-23T00:00:01.000Z',
  workflowState: 'raw',
  qualityState: 'unknown',
  qualityReason: 'unvalidated transport payload',
  value: '1.25',
  uncertainty: null,
  uncertaintyMethod: null,
  uncertaintyConfidence: null,
  provenance: 'synthetic-test',
  dataClassification: 'synthetic',
  correctionReason: null,
  totalizerTransition: null,
  measurementMethod: 'unconfigured',
  rawPayloadRef: null,
  rawPayloadHash: null,
  calibrationRef: null,
  ratingCurveRef: null,
};
const identityProvider: IdentityProvider = {
  async resolve(request) {
    return request.headers['x-isuv-user-id'] === userId
      ? { userId, provider: 'local-development' }
      : null;
  },
};
const session: Session = {
  user: {
    id: userId,
    organizationId,
    externalSubject: 'synthetic:hydrologist',
    displayName: 'Hydrologist',
    isActive: true,
    dataClassification: 'synthetic',
  },
  organization: {
    id: organizationId,
    code: 'OBS-TEST',
    name: 'Observation test',
    dataClassification: 'synthetic',
  },
  currentGrants: [],
  resolvedAt: '2026-08-23T00:00:00.000Z',
};
const sessionRepository: IdentitySessionRepository = {
  async findCurrentSession(id) {
    return id === userId ? session : null;
  },
};
const authorizationRepository: TerritoryAuthorizationRepository = {
  async findEffectiveGrantsForTarget(_id, territory) {
    return [
      {
        id: 'ea000000-0000-4000-8000-000000000001',
        role: 'hydrologist',
        scope: 'territory',
        territoryId: territoryA,
        coversTargetTerritory: territory === territoryA,
      },
    ];
  },
};
const service = {
  async resolveIngestionTerritory(id: string, _deviceId: string, observedAt: string) {
    return id === sensorId && observedAt < '2026-09-01T00:00:00.000Z' ? territoryA : null;
  },
  async findObservationTerritory(id: string) {
    return id === lineageId
      ? territoryA
      : id === 'e4000000-0000-4000-8000-000000000002'
        ? territoryB
        : null;
  },
  async ingest() {
    return { observation, idempotent: false };
  },
  async correct() {
    return observation;
  },
  async find(id: string) {
    return id === lineageId ? observation : null;
  },
  async history() {
    return { observations: [observation], nextCursor: null };
  },
} as unknown as PostgresObservationService;

test('observation routes fail closed without enumerating unknown or out-of-scope lineages and preserve request IDs', async () => {
  const app = createApp(async () => undefined, false, {
    identityProvider,
    identitySessionRepository: sessionRepository,
    territoryAuthorizationRepository: authorizationRepository,
    observationService: service,
  });
  const hidden = await app.inject({
    method: 'GET',
    url: '/api/v1/observations/e4000000-0000-4000-8000-000000000002',
    headers: { 'x-isuv-user-id': userId, 'x-request-id': 'hidden-observation' },
  });
  const unknown = await app.inject({
    method: 'GET',
    url: '/api/v1/observations/e4000000-0000-4000-8000-000000000099',
    headers: { 'x-isuv-user-id': userId },
  });
  assert.equal(hidden.statusCode, 404);
  assert.equal(unknown.statusCode, 404);
  assert.deepEqual(
    { code: hidden.json().error.code, message: hidden.json().error.message },
    { code: unknown.json().error.code, message: unknown.json().error.message },
  );
  assert.equal(hidden.json().error.requestId, 'hidden-observation');
  const history = await app.inject({
    method: 'GET',
    url: `/api/v1/observations/${lineageId}/history?limit=1`,
    headers: { 'x-isuv-user-id': userId },
  });
  assert.equal(history.statusCode, 200);
  assert.equal(history.json().observations[0].measurementKind, 'stage');
  await app.close();
});

test('anonymous observation requests do not resolve known identifiers and timezone-less as-of values are rejected', async () => {
  let lineageLookups = 0;
  const guardedService = {
    ...service,
    async findObservationTerritory(id: string) {
      lineageLookups += 1;
      return service.findObservationTerritory(id);
    },
  } as unknown as PostgresObservationService;
  const app = createApp(async () => undefined, false, {
    identityProvider,
    identitySessionRepository: sessionRepository,
    territoryAuthorizationRepository: authorizationRepository,
    observationService: guardedService,
  });
  const known = await app.inject({ method: 'GET', url: `/api/v1/observations/${lineageId}` });
  const unknown = await app.inject({
    method: 'GET',
    url: '/api/v1/observations/e4000000-0000-4000-8000-000000000099',
  });
  assert.equal(known.statusCode, 401);
  assert.equal(unknown.statusCode, 401);
  assert.deepEqual(
    { code: known.json().error.code, message: known.json().error.message },
    { code: unknown.json().error.code, message: unknown.json().error.message },
  );
  assert.equal(lineageLookups, 0);
  const timezoneLess = await app.inject({
    method: 'GET',
    url: `/api/v1/observations/${lineageId}?asOf=2026-08-23T00:00:00`,
    headers: { 'x-isuv-user-id': userId },
  });
  assert.equal(timezoneLess.statusCode, 400);
  const excessivePrecision = await app.inject({
    method: 'GET',
    url: `/api/v1/observations/${lineageId}?asOf=2026-08-23T00:00:00.0000001Z`,
    headers: { 'x-isuv-user-id': userId },
  });
  assert.equal(excessivePrecision.statusCode, 400);
  await app.close();
});

test('raw ingestion rejects estimated quality before resolving an identifier', async () => {
  const app = createApp(async () => undefined, false, {
    identityProvider,
    identitySessionRepository: sessionRepository,
    territoryAuthorizationRepository: authorizationRepository,
    observationService: service,
  });
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/observations',
    headers: { 'x-isuv-user-id': userId },
    payload: {
      sensorId,
      deviceId: observation.deviceId,
      measurementKind: 'stage',
      sourceSystem: 'test-adapter',
      sourceEventId: 'raw-estimated',
      observedAt: '2026-08-23T00:00:00.000Z',
      unit: 'm',
      value: '1.25',
      uncertainty: null,
      qualityState: 'estimated',
      qualityReason: 'unapproved estimate',
      totalizerTransition: null,
      provenance: 'synthetic-test',
      measurementMethod: 'unconfigured',
    },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, 'VALIDATION_ERROR');
  await app.close();
});

test('ingestion authorizes the installation territory at observed time, not sensor master territory', async () => {
  const relocationService = {
    ...service,
    async resolveIngestionTerritory(id: string, _deviceId: string, observedAt: string) {
      return id === sensorId && observedAt < '2026-01-01T00:00:00.000Z' ? territoryB : territoryA;
    },
  } as unknown as PostgresObservationService;
  const app = createApp(async () => undefined, false, {
    identityProvider,
    identitySessionRepository: sessionRepository,
    territoryAuthorizationRepository: authorizationRepository,
    observationService: relocationService,
  });
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/observations',
    headers: { 'x-isuv-user-id': userId },
    payload: {
      sensorId,
      deviceId: observation.deviceId,
      measurementKind: 'stage',
      sourceSystem: 'test-adapter',
      sourceEventId: 'historical-cross-territory',
      observedAt: '2025-12-31T23:59:59.000Z',
      unit: 'm',
      value: '1.25',
      uncertainty: null,
      qualityState: 'unknown',
      qualityReason: 'raw delayed payload',
      totalizerTransition: null,
      provenance: 'synthetic-test',
      measurementMethod: 'unconfigured',
    },
  });
  assert.equal(response.statusCode, 404);
  await app.close();
});
