import assert from 'node:assert/strict';
import test from 'node:test';
import {
  derivedVolumeResultSchema,
  deriveVolumeQuerySchema,
  ratingCurveKnotSchema,
} from './quantity-derivation.js';
test('quantity derivation contracts distinguish units and require explicit UTC interval endpoints', () => {
  assert.equal(ratingCurveKnotSchema.safeParse({ stageM: '1', dischargeM3s: '2' }).success, true);
  assert.equal(ratingCurveKnotSchema.safeParse({ stageM: '-1', dischargeM3s: '2' }).success, false);
  assert.equal(
    deriveVolumeQuerySchema.safeParse({
      sensorId: '00000000-0000-4000-8000-000000000001',
      method: 'direct_discharge',
      intervalStart: '2026-01-01T00:00:00.000000Z',
      intervalEnd: '2026-01-01T01:00:00.000000Z',
    }).success,
    true,
  );
  assert.equal(
    deriveVolumeQuerySchema.safeParse({
      sensorId: '00000000-0000-4000-8000-000000000001',
      method: 'direct_discharge',
      intervalStart: '2026-01-01T00:00:00',
      intervalEnd: '2026-01-01T01:00:00Z',
    }).success,
    false,
  );
  assert.equal(
    deriveVolumeQuerySchema.safeParse({
      sensorId: '00000000-0000-4000-8000-000000000001',
      method: 'direct_discharge',
      intervalStart: '2026-01-01T05:00:00.000001+05:00',
      intervalEnd: '2026-01-01T00:00:00.000001Z',
    }).success,
    false,
  );
  const deferred = derivedVolumeResultSchema.parse({
    outcome: 'deferred',
    deferReason: 'missing_exact_endpoint',
    volume: null,
    measurementKind: 'interval_volume',
    unit: 'm3',
    requestedInterval: {
      start: '2026-01-01T00:00:00.000000Z',
      end: '2026-01-01T01:00:00.000000Z',
    },
    coveredInterval: null,
    coverage: 'no_data',
    knownAt: '2026-01-01T01:00:00.000000Z',
    method: 'direct_discharge',
    policyVersionId: null,
    curveVersionId: null,
    sourceRefs: [],
    provenance: 'synthetic:test',
    dataClassification: 'synthetic',
    officialComplianceEligible: false,
    qualityState: 'no_data',
    uncertainty: null,
  });
  assert.equal(deferred.measurementKind, 'interval_volume');
  assert.equal(deferred.unit, 'm3');
  assert.equal(deferred.coverage, 'no_data');
});
