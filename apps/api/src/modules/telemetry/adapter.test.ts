import assert from 'node:assert/strict';
import test from 'node:test';
import { simulateTelemetry } from '@isuv/domain';
import {
  BoundedTelemetryReplayQueue,
  ingestSyntheticBatch,
  toIngestRequest,
  type TelemetryIngestionPort,
} from './adapter.js';

test('bounded replay queue preserves source identities, timestamps, order, and explicit overflow', () => {
  const [first, second] = simulateTelemetry('queue-seed', '2026-08-23T00:00:00.000Z', 1, 'normal');
  const queue = new BoundedTelemetryReplayQueue(1);
  assert.equal(queue.append(first!).accepted, true);
  assert.equal(queue.append(first!).accepted, false);
  assert.equal(queue.append(second!).overflowed, true);
  assert.deepEqual(
    queue.replay().map((entry) => entry.point.sourceEventId),
    [first!.sourceEventId],
  );
  assert.equal(queue.replay()[0]?.point.observedAt, first!.observedAt);
  queue.acknowledge(queue.replay()[0]!.sequence);
  assert.equal(queue.size, 0);
});

test('edge queue preserves an out-of-order source timestamp rather than rewriting it', () => {
  const later = simulateTelemetry('queue-seed', '2026-08-23T00:01:00.000Z', 1, 'normal')[0]!;
  const earlier = simulateTelemetry('queue-seed', '2026-08-23T00:00:00.000Z', 1, 'normal')[0]!;
  const queue = new BoundedTelemetryReplayQueue(2);
  queue.append(later);
  queue.append(earlier);
  assert.deepEqual(
    queue.replay().map((entry) => entry.point.observedAt),
    [later.observedAt, earlier.observedAt],
  );
  assert.ok(queue.replay()[0]!.point.observedAt > queue.replay()[1]!.point.observedAt);
});

test('synthetic adapter emits raw observations and makes replay/idempotency visible', async () => {
  const requests: ReturnType<typeof toIngestRequest>[] = [];
  const port: TelemetryIngestionPort = {
    async ingest(request) {
      requests.push(request);
      return {
        idempotent:
          requests.filter((candidate) => candidate.sourceEventId === request.sourceEventId).length >
          1,
        observation: {} as never,
      };
    },
  };
  const result = await ingestSyntheticBatch(
    port,
    'adapter-seed',
    '2026-08-23T00:00:00.000Z',
    2,
    'spike',
  );
  assert.deepEqual(result, {
    accepted: 249,
    idempotent: 0,
    gaps: 0,
    failures: 0,
    replayed: 249,
    overflowed: 0,
    statusEvents: [],
  });
  assert.equal(
    requests.every((request) => request.qualityState === 'suspect'),
    true,
  );
  assert.equal(
    requests.every((request) => request.sourceSystem === 'synthetic-simulator-v1'),
    true,
  );
  assert.equal(
    requests.some(
      (request) =>
        request.measurementKind === 'accumulated_volume' && request.totalizerTransition === null,
    ),
    false,
  );
  const duplicate = await ingestSyntheticBatch(
    port,
    'adapter-seed',
    '2026-08-23T00:00:00.000Z',
    2,
    'spike',
  );
  assert.equal(duplicate.idempotent, 249);
  assert.equal(duplicate.accepted, 0);
});

test('adapter leaves a conflicting event queued and reports the failure without false success', async () => {
  const port: TelemetryIngestionPort = {
    async ingest() {
      throw new Error('source payload conflict');
    },
  };
  const queue = new BoundedTelemetryReplayQueue(300);
  const result = await ingestSyntheticBatch(
    port,
    'conflict-seed',
    '2026-08-23T00:00:00.000Z',
    1,
    'normal',
    new Map(),
    queue,
  );
  assert.equal(result.failures, 1);
  assert.equal(result.accepted, 0);
  assert.equal(result.replayed, 0);
  assert.equal(queue.size, 249);
});
