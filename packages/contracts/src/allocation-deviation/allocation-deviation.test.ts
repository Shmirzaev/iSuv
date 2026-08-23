import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allocationDeviationQuerySchema,
  createAllocationEntryMeasurementBindingRequestSchema,
  requestSectionTolerancePolicyVersionRequestSchema,
} from './allocation-deviation.js';
test('allocation deviation query accepts microsecond windows and rejects reverse interval', () => {
  assert.equal(
    allocationDeviationQuerySchema.safeParse({
      intervalStart: '2026-01-01T00:00:00.000001Z',
      intervalEnd: '2026-01-01T00:00:00.000002Z',
    }).success,
    true,
  );
  assert.equal(
    allocationDeviationQuerySchema.safeParse({
      intervalStart: '2026-01-01T00:00:00.000002Z',
      intervalEnd: '2026-01-01T00:00:00.000001Z',
    }).success,
    false,
  );
  assert.equal(
    allocationDeviationQuerySchema.safeParse({
      intervalStart: '2026-01-01T05:00:00.000001+05:00',
      intervalEnd: '2026-01-01T00:00:00.000001Z',
    }).success,
    false,
  );
});

test('governed authoring schemas require explicit provenance, limits, and forward effective windows', () => {
  assert.equal(
    createAllocationEntryMeasurementBindingRequestSchema.safeParse({
      stationId: 'd1000000-0000-4000-8000-000000000001',
      sensorId: 'd1000000-0000-4000-8000-000000000002',
      deviceInstallationId: 'd1000000-0000-4000-8000-000000000003',
      method: 'direct_discharge',
      referencePlane: 'upstream',
      provenance: 'synthetic:contract-test',
      reason: 'bind planned delivery meter',
    }).success,
    true,
  );
  assert.equal(
    requestSectionTolerancePolicyVersionRequestSchema.safeParse({
      effectiveFrom: '2030-01-01T00:00:00.000000Z',
      underAbsoluteM3: '1',
      overAbsoluteM3: '1',
      combination: 'all',
      appliesToZeroPlan: true,
      reason: 'unbounded window',
    }).success,
    false,
  );
  assert.equal(
    requestSectionTolerancePolicyVersionRequestSchema.safeParse({
      effectiveFrom: '2030-01-02T00:00:00.000000Z',
      effectiveUntil: '2030-01-01T00:00:00.000000Z',
      combination: 'all',
      appliesToZeroPlan: true,
      reason: 'invalid window',
    }).success,
    false,
  );
  assert.equal(
    requestSectionTolerancePolicyVersionRequestSchema.safeParse({
      effectiveFrom: '2030-01-01T00:00:00.000000Z',
      effectiveUntil: '2030-01-02T00:00:00.000000Z',
      underAbsoluteM3: '1',
      overPercent: '5',
      combination: 'any',
      appliesToZeroPlan: false,
      reason: 'asymmetric configured tolerance',
    }).success,
    true,
  );
});
