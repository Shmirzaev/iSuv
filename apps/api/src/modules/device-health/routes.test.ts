import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { IdentityProvider } from '../identity/provider.js';
import type { IdentitySessionRepository } from '../identity/repository.js';
import type { TerritoryAuthorizationRepository } from '../authorization/service.js';
import { createApp } from '../../app.js';
import type { PostgresDeviceHealthService } from './service.js';

const userId = 'a3000000-0000-4000-8000-000000000001';
const territoryA = 'a2000000-0000-4000-8000-000000000004';
const territoryB = 'a2000000-0000-4000-8000-000000000005';
const deviceId = 'f1080001-0000-4000-8000-000000000000';
const identityProvider: IdentityProvider = {
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
        code: 'SYN',
        name: 'Synthetic',
        dataClassification: 'synthetic',
      },
      currentGrants: [],
      resolvedAt: '2026-08-24T00:00:00.000Z',
    };
  },
};
const authorization: TerritoryAuthorizationRepository = {
  async findEffectiveGrantsForTarget(_userId, territory) {
    return [
      {
        id: 'a4000000-0000-4000-8000-000000000001',
        role: 'maintenance_engineer',
        scope: 'territory',
        territoryId: territoryA,
        coversTargetTerritory: territory === territoryA,
      },
    ];
  },
};
function event(territoryId: string) {
  return {
    id: 'b1000000-0000-4000-8000-000000000001',
    organizationId: 'a1000000-0000-4000-8000-000000000001',
    territoryId,
    deviceId,
    deviceInstallationId: 'f1090001-0000-4000-8000-000000000000',
    sourceSystem: 'test',
    sourceEventId: `source-${territoryId}`,
    occurredAt: '2026-08-24T00:00:00.123456Z',
    receivedAt: '2026-08-24T00:00:01.000000Z',
    connectionStatus: 'communicating' as const,
    deviceFault: 'none' as const,
    dataCondition: 'unknown' as const,
    faultCode: null,
    power: { state: 'unknown' as const },
    signal: { state: 'unknown' as const },
    provenance: 'synthetic:test',
    dataClassification: 'synthetic' as const,
    synthetic: true,
  };
}
function service(): PostgresDeviceHealthService {
  const first = event(territoryA);
  const second = { ...event(territoryB), id: 'b1000000-0000-4000-8000-000000000002' };
  return {
    async resolveDeviceTerritory() {
      return territoryA;
    },
    async findCurrentTerritory() {
      // Current installation has moved to B; historical A facts remain
      // visible to an A-only reader through occurrence-time authorization.
      return territoryB;
    },
    async listOccurrenceTerritories() {
      return [territoryA, territoryB];
    },
    async ingest() {
      return { event: first, idempotent: false };
    },
    async current() {
      return {
        deviceId,
        organizationId: first.organizationId,
        territoryId: territoryA,
        deviceInstallationId: first.deviceInstallationId,
        connectionStatus: 'communicating' as const,
        deviceFault: 'none' as const,
        lastSeenReceivedAt: first.receivedAt,
        lastObservedAt: null,
        dataCondition: 'unconfigured' as const,
        faultCode: null,
        power: { state: 'unknown' as const },
        signal: { state: 'unknown' as const },
        provenance: first.provenance,
        dataClassification: 'synthetic' as const,
        synthetic: true,
        latestEventId: first.id,
        latestLiveEventId: '1',
      };
    },
    async history() {
      return { events: [first], nextCursor: null };
    },
    async live(
      _org: string,
      _cursor: bigint | null,
      _limit: number,
      _device: string,
      territories: readonly string[],
    ) {
      return {
        reset: false,
        events: [
          { id: '1', event: first },
          { id: '2', event: second },
        ].filter((record) => territories?.includes(record.event.territoryId)),
      };
    },
  } as unknown as PostgresDeviceHealthService;
}

test('device-health API fails closed, filters historical territory relocation facts, and rejects malformed stream cursors', async () => {
  const app = createApp(async () => undefined, false, {
    identityProvider,
    identitySessionRepository: sessions,
    territoryAuthorizationRepository: authorization,
    deviceHealthService: service(),
  });
  const history = await app.inject({
    method: 'GET',
    url: `/api/v1/device-health/${deviceId}/history`,
  });
  assert.equal(history.statusCode, 200);
  assert.equal(history.json().events.length, 1);
  assert.equal(history.json().events[0].territoryId, territoryA);
  const malformed = await app.inject({
    method: 'GET',
    url: `/api/v1/device-health/${deviceId}/live`,
    headers: { 'last-event-id': 'not-a-cursor' },
  });
  assert.equal(malformed.statusCode, 400);
  const conditionWrite = await app.inject({
    method: 'POST',
    url: '/api/v1/device-health/events',
    payload: {
      deviceId,
      sourceSystem: 'test',
      sourceEventId: 'condition-write',
      occurredAt: '2026-08-24T00:00:00.000000Z',
      connectionStatus: 'communicating',
      deviceFault: 'none',
      dataCondition: 'current',
      faultCode: null,
      power: { state: 'unknown' },
      signal: { state: 'unknown' },
      provenance: 'synthetic:test',
      dataClassification: 'synthetic',
    },
  });
  assert.equal(conditionWrite.statusCode, 400);
  const stream = await app.inject({
    method: 'GET',
    url: `/api/v1/device-health/${deviceId}/live`,
    headers: { 'last-event-id': '0' },
  });
  assert.equal(stream.statusCode, 200);
  assert.match(stream.body, /id: 1/);
  assert.doesNotMatch(stream.body, /id: 2/);
  assert.match(stream.body, /heartbeat/);
  assert.equal(stream.headers['x-isuv-live-reconnect'], 'Last-Event-ID');
  assert.equal(stream.headers['x-isuv-live-batch-limit'], '250');
  const atHead = await app.inject({
    method: 'GET',
    url: `/api/v1/device-health/${deviceId}/live`,
  });
  assert.equal(atHead.statusCode, 200);
  assert.match(atHead.body, /heartbeat/);
  assert.match(atHead.body, /id: 1/);
  assert.doesNotMatch(atHead.body, /id: 2/);
  await app.close();
});

test('device-health endpoints report database degradation without inferring an offline device', async () => {
  const unavailable = service();
  unavailable.resolveDeviceTerritory = async () => {
    throw new Error('database unavailable');
  };
  unavailable.findCurrentTerritory = async () => {
    throw new Error('database unavailable');
  };
  unavailable.listOccurrenceTerritories = async () => {
    throw new Error('database unavailable');
  };
  const app = createApp(async () => undefined, false, {
    identityProvider,
    identitySessionRepository: sessions,
    territoryAuthorizationRepository: authorization,
    deviceHealthService: unavailable,
  });
  const current = await app.inject({
    method: 'GET',
    url: `/api/v1/device-health/${deviceId}`,
  });
  const live = await app.inject({
    method: 'GET',
    url: `/api/v1/device-health/${deviceId}/live`,
  });
  const write = await app.inject({
    method: 'POST',
    url: '/api/v1/device-health/events',
    payload: {
      deviceId,
      sourceSystem: 'test',
      sourceEventId: 'database-unavailable',
      occurredAt: '2026-08-24T00:00:00.000000Z',
      connectionStatus: 'unknown',
      deviceFault: 'unknown',
      dataCondition: 'unconfigured',
      faultCode: null,
      power: { state: 'unknown' },
      signal: { state: 'unknown' },
      provenance: 'synthetic:test',
      dataClassification: 'synthetic',
    },
  });
  for (const response of [current, live, write]) {
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error.code, 'UNAVAILABLE');
    assert.doesNotMatch(response.body, /offline/i);
  }
  await app.close();
});
