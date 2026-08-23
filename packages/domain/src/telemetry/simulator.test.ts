import assert from 'node:assert/strict';
import test from 'node:test';
import { simulateTelemetry, simulateTelemetryEnvelope } from './simulator.js';

test('simulator deterministically covers 83 devices and keeps physical quantities distinct', () => {
  const normal = simulateTelemetry('test-seed', '2026-08-23T00:00:00.000Z', 3, 'normal');
  assert.equal(normal.length, 249);
  assert.deepEqual(normal, simulateTelemetry('test-seed', '2026-08-23T00:00:00.000Z', 3, 'normal'));
  assert.equal(new Set(normal.map((item) => item.deviceId)).size, 83);
  assert.deepEqual(new Set(normal.map((item) => item.unit)), new Set(['m', 'm3/s', 'm3']));
  const offline = simulateTelemetryEnvelope('test-seed', '2026-08-23T00:00:00.000Z', 3, 'offline');
  assert.equal(offline.points.length, 0);
  assert.equal(offline.statuses.length, 83);
  assert.equal(
    offline.statuses.every((status) => status.status === 'offline'),
    true,
  );
  const frozen = simulateTelemetry('test-seed', '2026-08-23T00:00:00.000Z', 4, 'frozen');
  assert.equal(
    frozen.find((item) => item.kind === 'stage')?.value,
    simulateTelemetry('test-seed', '2026-08-23T00:00:00.000Z', 5, 'frozen').find(
      (item) => item.kind === 'stage',
    )?.value,
  );
  assert.notEqual(
    normal[0]?.sourceEventId,
    simulateTelemetry('test-seed', '2026-08-23T00:01:00.000Z', 3, 'normal')[0]?.sourceEventId,
  );
});

test('simulator preserves microseconds and canonicalizes equivalent UTC offsets without collapsing IDs', () => {
  const utc = simulateTelemetryEnvelope(
    'microsecond-seed',
    '2026-08-23T00:00:00.123456Z',
    1,
    'normal',
  );
  const equivalentOffset = simulateTelemetryEnvelope(
    'microsecond-seed',
    '2026-08-23T05:00:00.123456+05:00',
    1,
    'normal',
  );
  const adjacentMicrosecond = simulateTelemetryEnvelope(
    'microsecond-seed',
    '2026-08-23T00:00:00.123457Z',
    1,
    'normal',
  );
  assert.equal(utc.generatedAt, '2026-08-23T00:00:00.123456Z');
  assert.equal(equivalentOffset.generatedAt, utc.generatedAt);
  assert.equal(equivalentOffset.points[0]?.sourceEventId, utc.points[0]?.sourceEventId);
  assert.notEqual(adjacentMicrosecond.points[0]?.sourceEventId, utc.points[0]?.sourceEventId);
  const stale = simulateTelemetryEnvelope(
    'microsecond-seed',
    '2026-08-23T00:00:00.123456Z',
    1,
    'stale',
  );
  assert.equal(stale.points[0]?.observedAt, '2026-08-22T23:45:00.123456Z');
});

test('normal cadence changes every physical quantity while frozen readings remain identical across advancing samples', () => {
  const atOne = '2026-08-23T00:00:00.000000Z';
  const atTwo = '2026-08-23T00:05:00.000000Z';
  const normalOne = simulateTelemetry('cadence-seed', atOne, 1, 'normal');
  const normalTwo = simulateTelemetry('cadence-seed', atTwo, 2, 'normal');
  const frozenOne = simulateTelemetry('cadence-seed', atOne, 1, 'frozen');
  const frozenTwo = simulateTelemetry('cadence-seed', atTwo, 2, 'frozen');
  for (const kind of ['stage', 'discharge', 'accumulated_volume'] as const) {
    const normalValueOne = normalOne.find(
      (point) => point.hotspot === 1 && point.kind === kind,
    )?.value;
    const normalValueTwo = normalTwo.find(
      (point) => point.hotspot === 1 && point.kind === kind,
    )?.value;
    const frozenValueOne = frozenOne.find(
      (point) => point.hotspot === 1 && point.kind === kind,
    )?.value;
    const frozenValueTwo = frozenTwo.find(
      (point) => point.hotspot === 1 && point.kind === kind,
    )?.value;
    assert.notEqual(normalValueOne, normalValueTwo, `normal ${kind} should vary with cadence`);
    assert.equal(frozenValueOne, frozenValueTwo, `frozen ${kind} should remain unchanged`);
    assert.notEqual(
      frozenOne.find((point) => point.hotspot === 1 && point.kind === kind)?.sourceEventId,
      frozenTwo.find((point) => point.hotspot === 1 && point.kind === kind)?.sourceEventId,
      `frozen ${kind} must still be a distinct later source event`,
    );
  }
});

test('simulator preserves raw validation boundaries and explicit totalizer transitions', () => {
  const at = '2026-08-23T00:00:00.000Z';
  const spike = simulateTelemetry('test-seed', at, 1, 'spike');
  const fault = simulateTelemetry('test-seed', at, 1, 'device_fault');
  const stale = simulateTelemetry('test-seed', at, 1, 'stale');
  const reset = simulateTelemetry('test-seed', at, 1, 'reset');
  const rollover = simulateTelemetry('test-seed', at, 1, 'rollover');
  const over = simulateTelemetry('test-seed', at, 3, 'over');
  const under = simulateTelemetry('test-seed', at, 3, 'under');
  const normal = simulateTelemetry('test-seed', at, 3, 'normal');
  assert.equal(
    spike.every((item) => item.qualityState === 'suspect'),
    true,
  );
  assert.equal(
    fault.every((item) => item.qualityState === 'invalid'),
    true,
  );
  assert.equal(
    stale.every((item) => item.observedAt < at),
    true,
  );
  assert.equal(
    reset
      .filter((item) => item.kind === 'accumulated_volume')
      .every((item) => item.totalizerTransition === 'reset_reported'),
    true,
  );
  assert.equal(
    rollover
      .filter((item) => item.kind === 'accumulated_volume')
      .every((item) => item.totalizerTransition === 'rollover_reported'),
    true,
  );
  assert.equal(
    reset.some((item) => item.kind === 'stage' && item.totalizerTransition !== null),
    false,
  );
  const counter = (points: ReturnType<typeof simulateTelemetry>) =>
    Number(
      points.find((point) => point.hotspot === 1 && point.kind === 'accumulated_volume')?.value,
    );
  assert.ok(counter(over) > counter(normal));
  assert.ok(counter(under) < counter(normal));
  assert.ok(counter(spike) > counter(over));
  for (const kind of ['stage', 'discharge', 'accumulated_volume'] as const) {
    const value = (points: ReturnType<typeof simulateTelemetry>) =>
      Number(points.find((point) => point.hotspot === 1 && point.kind === kind)?.value);
    assert.ok(value(over) > value(normal), `over ${kind} must exceed normal at an equal step`);
    assert.ok(value(under) < value(normal), `under ${kind} must be below normal at an equal step`);
  }
  assert.equal(
    [...over, ...under, ...spike]
      .filter((point) => point.kind === 'accumulated_volume')
      .every((point) => Number(point.value) >= 0 && point.totalizerTransition === 'normal'),
    true,
  );
});
