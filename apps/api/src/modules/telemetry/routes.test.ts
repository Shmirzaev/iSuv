import assert from 'node:assert/strict';
import test from 'node:test';
import type { IngestObservationRequest, IngestObservationResponse, Session } from '@isuv/contracts';
import { createApp } from '../../app.js';
import type { TerritoryAuthorizationRepository } from '../authorization/service.js';
import type { IdentityProvider } from '../identity/provider.js';
import type { IdentitySessionRepository } from '../identity/repository.js';
import type { PostgresObservationService } from '../observations/service.js';

const userId = 'e3000000-0000-4000-8000-000000000001';
const territoryA = 'e2000000-0000-4000-8000-000000000001';
const territoryB = 'e2000000-0000-4000-8000-000000000002';
const session: Session = {
  user: {
    id: userId,
    organizationId: 'e1000000-0000-4000-8000-000000000001',
    externalSubject: 'synthetic:telemetry',
    displayName: 'Telemetry tester',
    isActive: true,
    dataClassification: 'synthetic',
  },
  organization: {
    id: 'e1000000-0000-4000-8000-000000000001',
    code: 'SYN',
    name: 'Synthetic',
    dataClassification: 'synthetic',
  },
  currentGrants: [],
  resolvedAt: '2026-08-23T00:00:00.000Z',
};
const identityProvider: IdentityProvider = {
  async resolve(request) {
    return request.headers['x-isuv-user-id'] === userId
      ? { userId, provider: 'local-development' }
      : null;
  },
};
const sessionRepository: IdentitySessionRepository = {
  async findCurrentSession(id) {
    return id === userId ? session : null;
  },
};

function authorizationRepository(
  role: 'hydrologist' | 'auditor' | 'system_admin' = 'hydrologist',
): TerritoryAuthorizationRepository {
  return {
    async findEffectiveGrantsForTarget(_user, territory) {
      return role === 'system_admin'
        ? [
            {
              id: 'ea000000-0000-4000-8000-000000000001',
              role,
              scope: 'system',
              territoryId: null,
              coversTargetTerritory: false,
            },
          ]
        : [
            {
              id: 'ea000000-0000-4000-8000-000000000001',
              role,
              scope: 'territory',
              territoryId: territoryA,
              coversTargetTerritory: territory === territoryA,
            },
          ];
    },
  };
}

function observationService(crossTerritory = false) {
  const ingested: { request: IngestObservationRequest; territory: string | undefined }[] = [];
  const service = {
    async resolveIngestionTerritory(_sensorId: string, deviceId: string) {
      return crossTerritory && deviceId.startsWith('f1080002') ? territoryB : territoryA;
    },
    async ingest(
      request: IngestObservationRequest,
      expectedTerritoryId?: string,
    ): Promise<IngestObservationResponse> {
      ingested.push({ request, territory: expectedTerritoryId });
      return { idempotent: false, observation: {} as never };
    },
  } as unknown as PostgresObservationService;
  return { service, ingested };
}

async function withSimulatorEnabled(action: () => Promise<void>): Promise<void> {
  const priorEnabled = process.env.ISUV_ENABLE_SYNTHETIC_SIMULATOR;
  const priorNodeEnv = process.env.NODE_ENV;
  process.env.ISUV_ENABLE_SYNTHETIC_SIMULATOR = 'true';
  delete process.env.NODE_ENV;
  try {
    await action();
  } finally {
    if (priorEnabled === undefined) delete process.env.ISUV_ENABLE_SYNTHETIC_SIMULATOR;
    else process.env.ISUV_ENABLE_SYNTHETIC_SIMULATOR = priorEnabled;
    if (priorNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = priorNodeEnv;
  }
}

test('simulator is disabled by default and hard-refuses production', async () => {
  const { service } = observationService();
  const app = createApp(async () => undefined, false, {
    identityProvider,
    identitySessionRepository: sessionRepository,
    territoryAuthorizationRepository: authorizationRepository(),
    observationService: service,
  });
  assert.equal(
    (await app.inject({ method: 'GET', url: '/api/v1/telemetry/simulator/preview' })).statusCode,
    404,
  );
  const priorEnabled = process.env.ISUV_ENABLE_SYNTHETIC_SIMULATOR;
  const priorNodeEnv = process.env.NODE_ENV;
  process.env.ISUV_ENABLE_SYNTHETIC_SIMULATOR = 'true';
  process.env.NODE_ENV = 'production';
  try {
    assert.equal(
      (await app.inject({ method: 'GET', url: '/api/v1/telemetry/simulator/preview' })).statusCode,
      404,
    );
  } finally {
    if (priorEnabled === undefined) delete process.env.ISUV_ENABLE_SYNTHETIC_SIMULATOR;
    else process.env.ISUV_ENABLE_SYNTHETIC_SIMULATOR = priorEnabled;
    if (priorNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = priorNodeEnv;
  }
  await app.close();
});

test(
  'enabled simulator treats unknown and inactive identities as unauthenticated',
  { concurrency: false },
  async () => {
    await withSimulatorEnabled(async () => {
      const { service } = observationService();
      const provider: IdentityProvider = {
        async resolve(request) {
          if (request.headers['x-isuv-user-id'] === 'inactive')
            return { userId: 'inactive', provider: 'local-development' };
          return null;
        },
      };
      const sessions: IdentitySessionRepository = {
        async findCurrentSession() {
          return null;
        },
      };
      const app = createApp(async () => undefined, false, {
        identityProvider: provider,
        identitySessionRepository: sessions,
        territoryAuthorizationRepository: authorizationRepository(),
        observationService: service,
      });
      const unknown = await app.inject({
        method: 'GET',
        url: '/api/v1/telemetry/simulator/preview?at=2026-08-23T00:00:00.000Z',
      });
      const inactive = await app.inject({
        method: 'GET',
        url: '/api/v1/telemetry/simulator/preview?at=2026-08-23T00:00:00.000Z',
        headers: { 'x-isuv-user-id': 'inactive' },
      });
      assert.equal(unknown.statusCode, 401);
      assert.equal(inactive.statusCode, 401);
      assert.deepEqual(
        { code: unknown.json().error.code, message: unknown.json().error.message },
        { code: inactive.json().error.code, message: inactive.json().error.message },
      );
      await app.close();
    });
  },
);

test(
  'simulator authenticates before resolving assets and labels preview values synthetic',
  { concurrency: false },
  async () => {
    await withSimulatorEnabled(async () => {
      let resolutions = 0;
      const { service } = observationService();
      const guarded = {
        ...service,
        async resolveIngestionTerritory(...args: [string, string, string]) {
          resolutions += 1;
          return service.resolveIngestionTerritory(...args);
        },
      } as unknown as PostgresObservationService;
      const app = createApp(async () => undefined, false, {
        identityProvider,
        identitySessionRepository: sessionRepository,
        territoryAuthorizationRepository: authorizationRepository(),
        observationService: guarded,
      });
      assert.equal(
        (
          await app.inject({
            method: 'GET',
            url: '/api/v1/telemetry/simulator/preview?at=2026-08-23T00:00:00.000Z',
          })
        ).statusCode,
        401,
      );
      assert.equal(resolutions, 0);
      const invalid = await app.inject({
        method: 'GET',
        url: '/api/v1/telemetry/simulator/preview?at=2026-08-23T00:00:00.0000001Z',
        headers: { 'x-isuv-user-id': userId },
      });
      assert.equal(invalid.statusCode, 400);
      assert.equal(resolutions, 0);
      const preview = await app.inject({
        method: 'GET',
        url: '/api/v1/telemetry/simulator/preview?at=2026-08-23T00:00:00.000Z&limit=3',
        headers: { 'x-isuv-user-id': userId },
      });
      assert.equal(preview.statusCode, 200);
      assert.equal(preview.json().classification, 'synthetic');
      assert.equal(preview.json().points.length, 3);
      assert.deepEqual(
        new Set(preview.json().points.map((point: { unit: string }) => point.unit)),
        new Set(['m', 'm3/s', 'm3']),
      );
      await app.close();
    });
  },
);

test(
  'simulator run needs write authority across every derived territory and binds expected territory',
  { concurrency: false },
  async () => {
    await withSimulatorEnabled(async () => {
      const allowed = observationService();
      const app = createApp(async () => undefined, false, {
        identityProvider,
        identitySessionRepository: sessionRepository,
        territoryAuthorizationRepository: authorizationRepository(),
        observationService: allowed.service,
      });
      const run = await app.inject({
        method: 'POST',
        url: '/api/v1/telemetry/simulator/run',
        headers: { 'x-isuv-user-id': userId },
        payload: { at: '2026-08-23T00:00:00.000Z', scenario: 'normal' },
      });
      assert.equal(run.statusCode, 200);
      assert.equal(run.json().result.accepted, 249);
      assert.equal(allowed.ingested.length, 249);
      assert.equal(
        allowed.ingested.every((item) => item.territory === territoryA),
        true,
      );
      await app.close();

      const cross = observationService(true);
      const crossApp = createApp(async () => undefined, false, {
        identityProvider,
        identitySessionRepository: sessionRepository,
        territoryAuthorizationRepository: authorizationRepository(),
        observationService: cross.service,
      });
      const denied = await crossApp.inject({
        method: 'POST',
        url: '/api/v1/telemetry/simulator/run',
        headers: { 'x-isuv-user-id': userId },
        payload: { at: '2026-08-23T00:00:00.000Z', scenario: 'normal' },
      });
      assert.equal(denied.statusCode, 404);
      assert.equal(cross.ingested.length, 0);
      await crossApp.close();

      const system = observationService(true);
      const systemApp = createApp(async () => undefined, false, {
        identityProvider,
        identitySessionRepository: sessionRepository,
        territoryAuthorizationRepository: authorizationRepository('system_admin'),
        observationService: system.service,
      });
      const systemRun = await systemApp.inject({
        method: 'POST',
        url: '/api/v1/telemetry/simulator/run',
        headers: { 'x-isuv-user-id': userId },
        payload: { at: '2026-08-23T00:00:00.000Z', scenario: 'normal' },
      });
      assert.equal(systemRun.statusCode, 200);
      assert.equal(system.ingested.length, 249);
      assert.equal(
        system.ingested.some((item) => item.territory === territoryB),
        true,
      );
      await systemApp.close();
    });
  },
);

test(
  'auditors cannot run the simulator and offline emits statuses without numeric ingestion',
  { concurrency: false },
  async () => {
    await withSimulatorEnabled(async () => {
      const denied = observationService();
      const deniedApp = createApp(async () => undefined, false, {
        identityProvider,
        identitySessionRepository: sessionRepository,
        territoryAuthorizationRepository: authorizationRepository('auditor'),
        observationService: denied.service,
      });
      const response = await deniedApp.inject({
        method: 'POST',
        url: '/api/v1/telemetry/simulator/run',
        headers: { 'x-isuv-user-id': userId },
        payload: { at: '2026-08-23T00:00:00.000Z', scenario: 'normal' },
      });
      assert.equal(response.statusCode, 404);
      assert.equal(denied.ingested.length, 0);
      await deniedApp.close();

      const offline = observationService();
      const offlineApp = createApp(async () => undefined, false, {
        identityProvider,
        identitySessionRepository: sessionRepository,
        territoryAuthorizationRepository: authorizationRepository(),
        observationService: offline.service,
      });
      const responseOffline = await offlineApp.inject({
        method: 'POST',
        url: '/api/v1/telemetry/simulator/run',
        headers: { 'x-isuv-user-id': userId },
        payload: { at: '2026-08-23T00:00:00.000Z', scenario: 'offline' },
      });
      assert.equal(responseOffline.statusCode, 200);
      assert.equal(responseOffline.json().result.gaps, 83);
      assert.equal(responseOffline.json().result.statusEvents.length, 83);
      assert.equal(offline.ingested.length, 0);
      await offlineApp.close();
    });
  },
);
