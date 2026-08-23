import assert from 'node:assert/strict';
import test from 'node:test';
import { ingestObservationRequestSchema } from './observations.js';

const base = {
  sensorId: 'a1000000-0000-4000-8000-000000000001',
  deviceId: 'a2000000-0000-4000-8000-000000000001',
  sourceSystem: 'synthetic-adapter',
  sourceEventId: 'event-1',
  observedAt: '2026-08-23T00:00:00.000Z',
  value: '1.2500',
  uncertainty: null,
  qualityState: 'unknown',
  qualityReason: 'awaiting automated validation',
  totalizerTransition: null,
  provenance: 'synthetic-contract-test',
  measurementMethod: 'unconfigured',
};

test('ingestion requires an explicit quantity kind and rejects cross-quantity unit pairs', () => {
  assert.equal(
    ingestObservationRequestSchema.safeParse({ ...base, measurementKind: 'stage', unit: 'm' })
      .success,
    true,
  );
  for (const invalid of [
    { measurementKind: 'stage', unit: 'm3/s' },
    { measurementKind: 'discharge', unit: 'm' },
    { measurementKind: 'accumulated_volume', unit: 'm3/s' },
  ])
    assert.equal(ingestObservationRequestSchema.safeParse({ ...base, ...invalid }).success, false);
  assert.equal(ingestObservationRequestSchema.safeParse({ ...base, unit: 'm' }).success, false);
  assert.equal(
    ingestObservationRequestSchema.safeParse({
      ...base,
      measurementKind: 'stage',
      unit: 'm',
      qualityState: 'estimated',
      qualityReason: 'raw estimate',
    }).success,
    false,
  );
  assert.equal(
    ingestObservationRequestSchema.safeParse({
      ...base,
      measurementKind: 'stage',
      unit: 'm',
      value: '1000000000000000000',
    }).success,
    false,
  );
  assert.equal(
    ingestObservationRequestSchema.safeParse({
      ...base,
      measurementKind: 'stage',
      unit: 'm',
      observedAt: '2026-08-23T00:00:00.0000001Z',
    }).success,
    false,
  );
});
