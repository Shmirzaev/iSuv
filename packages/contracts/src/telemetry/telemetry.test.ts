import assert from 'node:assert/strict';
import test from 'node:test';
import {
  simulatorPreviewRequestSchema,
  telemetryBatchResultSchema,
  telemetryStatusSchema,
} from './telemetry.js';

test('simulator contract bounds batches and shares microsecond UTC precision rules', () => {
  assert.equal(
    simulatorPreviewRequestSchema.safeParse({ at: '2026-08-23T00:00:00.123456Z', limit: '249' })
      .success,
    true,
  );
  assert.equal(
    simulatorPreviewRequestSchema.safeParse({ at: '2026-08-23T00:00:00.1234567Z' }).success,
    false,
  );
  assert.equal(
    simulatorPreviewRequestSchema.safeParse({ at: '2026-08-23T00:00:00.000Z', limit: 250 }).success,
    false,
  );
  assert.equal(
    simulatorPreviewRequestSchema.safeParse({ at: '2026-08-23T00:00:00' }).success,
    false,
  );
  assert.equal(
    simulatorPreviewRequestSchema.safeParse({ at: '2026-08-23T00:00:00.000Z', step: -1 }).success,
    false,
  );
  assert.equal(
    telemetryBatchResultSchema.safeParse({
      accepted: 0,
      idempotent: 0,
      gaps: 83,
      failures: 0,
      replayed: 0,
      overflowed: 0,
      statusEvents: [
        {
          hotspot: 1,
          deviceId: 'f1080001-0000-4000-8000-000000000000',
          observedAt: '2026-08-23T00:00:00.000Z',
          sourceEventId: 'synthetic:status',
          status: 'offline',
          scenario: 'offline',
          provenance: 'synthetic',
          faultCode: null,
        },
      ],
    }).success,
    true,
  );

  assert.equal(
    telemetryStatusSchema.safeParse({
      hotspot: 1,
      deviceId: 'f1080001-0000-4000-8000-000000000000',
      observedAt: '2026-08-23T00:00:00.123456Z',
      sourceEventId: 'synthetic:offline',
      status: 'offline',
      scenario: 'offline',
      provenance: 'synthetic',
      faultCode: null,
    }).success,
    true,
  );
  assert.equal(
    telemetryStatusSchema.safeParse({
      hotspot: 1,
      deviceId: 'f1080001-0000-4000-8000-000000000000',
      observedAt: '2026-08-23T00:00:00.123456Z',
      sourceEventId: 'synthetic:device-fault',
      status: 'device_fault',
      scenario: 'device_fault',
      provenance: 'synthetic',
      faultCode: 'SYNTHETIC_DEVICE_FAULT',
    }).success,
    true,
  );
  assert.equal(
    telemetryStatusSchema.safeParse({
      hotspot: 1,
      deviceId: 'f1080001-0000-4000-8000-000000000000',
      observedAt: '2026-08-23T00:00:00.123456Z',
      sourceEventId: 'synthetic:offline-with-fault',
      status: 'offline',
      scenario: 'offline',
      provenance: 'synthetic',
      faultCode: 'MUST_NOT_BE_PRESENT',
    }).success,
    false,
  );
  assert.equal(
    telemetryStatusSchema.safeParse({
      hotspot: 1,
      deviceId: 'f1080001-0000-4000-8000-000000000000',
      observedAt: '2026-08-23T00:00:00.123456Z',
      sourceEventId: 'synthetic:fault-without-code',
      status: 'device_fault',
      scenario: 'device_fault',
      provenance: 'synthetic',
      faultCode: null,
    }).success,
    false,
  );
  assert.equal(
    telemetryStatusSchema.safeParse({
      hotspot: 1,
      deviceId: 'f1080001-0000-4000-8000-000000000000',
      observedAt: '2026-08-23T00:00:00.123456Z',
      sourceEventId: 'synthetic:status-scenario-mismatch',
      status: 'offline',
      scenario: 'device_fault',
      provenance: 'synthetic',
      faultCode: null,
    }).success,
    false,
  );
});
