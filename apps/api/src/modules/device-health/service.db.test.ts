import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { Pool } from 'pg';
import { PostgresDeviceHealthService } from './service.js';
import { PostgresObservationService } from '../observations/service.js';
import { simulateTelemetry } from '@isuv/domain';
import { toIngestRequest } from '../telemetry/adapter.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for database integration tests');
const pool = new Pool({ connectionString: databaseUrl, max: 2 });
after(async () => pool.end());
// Keep this fixture away from both the early hotspot devices exercised by the
// core telemetry suites and hotspot 083, whose governed history drives P6 analytics.
const deviceId = 'f1080052-0000-4000-8000-000000000000';

function fact(sourceEventId: string, occurredAt = '2026-08-24T00:00:00.123456Z') {
  return {
    deviceId,
    sourceSystem: 'device-health-test',
    sourceEventId,
    occurredAt,
    connectionStatus: 'offline' as const,
    deviceFault: 'none' as const,
    dataCondition: 'unconfigured' as const,
    faultCode: null,
    power: { state: 'unknown' as const },
    signal: { state: 'measured' as const, value: '0', unit: 'dBm' as const },
    provenance: 'synthetic:device-health-test',
    dataClassification: 'synthetic' as const,
  };
}

test(
  'health facts are idempotent, retain microseconds, preserve unknown/measured metadata, and never infer numeric-observation freshness',
  { concurrency: false },
  async () => {
    const client = await pool.connect();
    await client.query('BEGIN');
    try {
      const service = new PostgresDeviceHealthService(
        databaseUrl,
        client,
        () => new Date('2026-08-24T00:00:05.000Z'),
      );
      const sourceEventId = `health-${randomUUID()}`;
      const first = await service.ingest(fact(sourceEventId));
      const replay = await service.ingest(fact(sourceEventId));
      assert.equal(first.idempotent, false);
      assert.equal(replay.idempotent, true);
      assert.equal(first.event.occurredAt, '2026-08-24T00:00:00.123456Z');
      assert.deepEqual(first.event.power, { state: 'unknown' });
      assert.deepEqual(first.event.signal, { state: 'measured', value: '0', unit: 'dBm' });
      await assert.rejects(
        service.ingest({ ...fact(sourceEventId), connectionStatus: 'communicating' }),
        /reused/,
      );
      const snapshot = await service.current(deviceId);
      assert.equal(snapshot?.connectionStatus, 'offline');
      assert.equal(snapshot?.lastSeenReceivedAt, '2026-08-24T00:00:05.000000Z');
      assert.equal(snapshot?.lastObservedAt, null);
      assert.equal(snapshot?.dataCondition, 'unconfigured');
      const callerAssertedCondition = await service.ingest({
        ...fact(`caller-condition-${randomUUID()}`),
        dataCondition: 'current',
      });
      assert.equal(callerAssertedCondition.event.dataCondition, 'unconfigured');
      const callerAssertedOfficial = await service.ingest({
        ...fact(`caller-official-${randomUUID()}`),
        dataClassification: 'official',
      });
      assert.equal(callerAssertedOfficial.event.dataClassification, 'synthetic');
      const pageOne = await service.history(deviceId, { limit: 1 }, [
        'a2000000-0000-4000-8000-000000000004',
      ]);
      const pageTwo = await service.history(deviceId, { limit: 1, cursor: pageOne.nextCursor! }, [
        'a2000000-0000-4000-8000-000000000004',
      ]);
      assert.notEqual(pageOne.events[0]?.id, pageTwo.events[0]?.id);
      assert.equal(pageOne.events[0]?.receivedAt, pageTwo.events[0]?.receivedAt);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  },
);

test(
  'delayed health facts add history/journal but do not regress the current occurrence-time projection',
  { concurrency: false },
  async () => {
    const client = await pool.connect();
    await client.query('BEGIN');
    try {
      let now = new Date('2026-08-24T00:00:10.000Z');
      const service = new PostgresDeviceHealthService(databaseUrl, client, () => now);
      const suffix = randomUUID();
      await service.ingest({
        ...fact(`new-${suffix}`, '2026-08-24T00:10:00.000001Z'),
        connectionStatus: 'communicating',
      });
      now = new Date('2026-08-24T00:00:20.000Z');
      await service.ingest({
        ...fact(`old-${suffix}`, '2026-08-24T00:00:00.000001Z'),
        connectionStatus: 'offline',
      });
      const current = await service.current(deviceId);
      assert.equal(current?.connectionStatus, 'communicating');
      assert.equal(current?.lastSeenReceivedAt, '2026-08-24T00:00:20.000000Z');
      const history = await service.history(deviceId, { limit: 10 }, [
        'a2000000-0000-4000-8000-000000000004',
      ]);
      assert.equal(history.events.filter((item) => item.sourceEventId.endsWith(suffix)).length, 2);
      const stream = await service.live(
        'a1000000-0000-4000-8000-000000000001',
        null,
        250,
        deviceId,
        ['a2000000-0000-4000-8000-000000000004'],
      );
      assert.equal(
        stream.events.some((item) => item.event.sourceEventId === `new-${suffix}`),
        true,
      );
      assert.equal(
        stream.events.some((item) => item.event.sourceEventId === `old-${suffix}`),
        true,
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  },
);

test(
  'accepted numeric observations journal communicating health in the same transaction without treating raw unknown data as normal',
  { concurrency: false },
  async () => {
    const client = await pool.connect();
    await client.query('BEGIN');
    try {
      const observationService = new PostgresObservationService(databaseUrl, client);
      const point = simulateTelemetry(
        `observation-health-${randomUUID()}`,
        '2026-08-24T01:02:03.123456Z',
        2,
        'normal',
      ).find((candidate) => candidate.deviceId === deviceId)!;
      const ingested = await observationService.ingest(toIngestRequest(point));
      const health = new PostgresDeviceHealthService(databaseUrl, client);
      const snapshot = await health.current(point.deviceId);
      assert.equal(snapshot?.connectionStatus, 'communicating');
      assert.equal(snapshot?.lastObservedAt, point.observedAt);
      assert.equal(snapshot?.dataCondition, 'unknown');
      const journal = await health.live(
        'a1000000-0000-4000-8000-000000000001',
        null,
        250,
        point.deviceId,
        ['a2000000-0000-4000-8000-000000000004'],
      );
      assert.equal(
        journal.events.some((item) => item.event.sourceSystem === 'observation-health-v1'),
        true,
      );
      const receipt = snapshot!.lastSeenReceivedAt;
      await health.ingest({
        ...fact(`reported-fault-${randomUUID()}`, point.observedAt),
        connectionStatus: 'unknown',
        deviceFault: 'reported',
        faultCode: 'SYNTHETIC_FAULT',
      });
      const receiptAfterFault = (await health.current(point.deviceId))!.lastSeenReceivedAt;
      await health.ingestAcceptedObservation({
        ...ingested.observation,
        id: randomUUID(),
        revision: 2,
        workflowState: 'automatically_validated',
        qualityState: 'valid',
        qualityReason: null,
        ingestedAt: receipt,
      });
      const afterValidation = await health.current(point.deviceId);
      assert.equal(afterValidation?.lastSeenReceivedAt, receiptAfterFault);
      assert.equal(afterValidation?.lastObservedAt, point.observedAt);
      assert.equal(afterValidation?.dataCondition, 'unknown');
      assert.equal(afterValidation?.deviceFault, 'reported');
      const connectionBeforeRejection = afterValidation!.connectionStatus;
      await health.ingestAcceptedObservation({
        ...ingested.observation,
        id: randomUUID(),
        revision: 3,
        workflowState: 'rejected',
        qualityState: 'invalid',
        qualityReason: 'expert rejected the numerical evidence',
        ingestedAt: '2026-08-24T02:00:00.000000Z',
      });
      const afterRejection = await health.current(point.deviceId);
      assert.equal(afterRejection?.lastSeenReceivedAt, receiptAfterFault);
      assert.equal(afterRejection?.lastObservedAt, point.observedAt);
      assert.equal(afterRejection?.connectionStatus, connectionBeforeRejection);
      assert.equal(afterRejection?.dataCondition, 'unreliable');
      assert.equal(afterRejection?.deviceFault, 'reported');
      await health.ingest({
        ...fact(`cleared-fault-${randomUUID()}`, '2026-08-24T01:02:04.000000Z'),
        connectionStatus: 'communicating',
      });
      assert.equal((await health.current(point.deviceId))?.deviceFault, 'none');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  },
);

test(
  'concurrent source ingestion is one durable fact: replay is idempotent and conflict is singular',
  { concurrency: false },
  async () => {
    const source = `concurrent-${randomUUID()}`;
    const input = fact(source, '2026-08-24T02:00:00.000001Z');
    const left = new PostgresDeviceHealthService(
      databaseUrl,
      undefined,
      () => new Date('2026-08-24T02:00:01Z'),
    );
    const right = new PostgresDeviceHealthService(
      databaseUrl,
      undefined,
      () => new Date('2026-08-24T02:00:01Z'),
    );
    try {
      const replay = await Promise.all([left.ingest(input), right.ingest(input)]);
      assert.equal(replay.filter((result) => result.idempotent).length, 1);
      assert.equal(replay.filter((result) => !result.idempotent).length, 1);
      assert.equal(
        (
          await pool.query(
            'SELECT 1 FROM device_health_events WHERE source_system=$1 AND source_event_id=$2',
            [input.sourceSystem, source],
          )
        ).rowCount,
        1,
      );
      assert.equal(
        (
          await pool.query(
            `SELECT 1 FROM device_live_event_journal journal JOIN device_health_events event ON event.id=journal.health_event_id
             WHERE event.source_system=$1 AND event.source_event_id=$2`,
            [input.sourceSystem, source],
          )
        ).rowCount,
        1,
      );

      const conflictSource = `concurrent-conflict-${randomUUID()}`;
      const accepted = fact(conflictSource, '2026-08-24T02:00:02.000001Z');
      const conflict = { ...accepted, connectionStatus: 'communicating' as const };
      const results = await Promise.allSettled([left.ingest(accepted), right.ingest(conflict)]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
      assert.equal(
        (
          await pool.query(
            'SELECT 1 FROM device_health_events WHERE source_system=$1 AND source_event_id=$2',
            [accepted.sourceSystem, conflictSource],
          )
        ).rowCount,
        1,
      );
    } finally {
      // Device-health facts are append-only.  This regression runs against a
      // fresh disposable database and deliberately does not weaken that DB
      // invariant just to remove its evidence.
    }
  },
);
