import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  deriveCounterInterval,
  integrateSeries,
  interpolateStage,
  parseExactDecimal,
  utcMicros,
} from './model.js';

const base = {
  lineageId: '00000000-0000-4000-8000-000000000001',
  revisionId: '00000000-0000-4000-8000-000000000002',
  sensorId: '00000000-0000-4000-8000-000000000003',
  deviceInstallationId: '00000000-0000-4000-8000-000000000004',
  measurementMethod: 'synthetic fixture',
  totalizerTransition: null,
  workflowState: 'expert_validated',
  qualityState: 'valid',
};
function observation(observedAt: string, value: string) {
  return { ...base, observedAt, value };
}
test('quantity derivation parses decimal/timestamp exactly and interpolates rating knots', () => {
  assert.deepEqual(parseExactDecimal('1.250'), { numerator: 5n, denominator: 4n });
  assert.equal(utcMicros('1970-01-01T00:00:00.000001Z'), 1n);
  assert.equal(utcMicros('1970-01-01T05:00:00.000001+05:00'), 1n);
  assert.deepEqual(
    interpolateStage(
      [
        { stageM: '0', dischargeM3s: '0' },
        { stageM: '2', dischargeM3s: '3' },
      ],
      parseExactDecimal('1'),
    ),
    { numerator: 3n, denominator: 2n },
  );
  assert.equal(
    interpolateStage(
      [
        { stageM: '0', dischargeM3s: '0' },
        { stageM: '2', dischargeM3s: '3' },
      ],
      parseExactDecimal('3'),
    ),
    null,
  );
});
test('trapezoidal direct and stage integration preserve microseconds and defer unsafe series', () => {
  const first = '2026-01-01T00:00:00.000000Z',
    last = '2026-01-01T00:00:01.000001Z';
  const computed = integrateSeries(
    first,
    last,
    [observation(first, '1'), observation(last, '3')],
    2_000_000n,
  );
  assert.equal(computed.outcome, 'computed');
  if (computed.outcome === 'computed')
    assert.deepEqual(computed.value, { numerator: 1000001n, denominator: 500000n });
  const stage = integrateSeries(
    first,
    last,
    [observation(first, '0'), observation(last, '2')],
    2_000_000n,
    (value) =>
      interpolateStage(
        [
          { stageM: '0', dischargeM3s: '1' },
          { stageM: '2', dischargeM3s: '3' },
        ],
        parseExactDecimal(value),
      ),
  );
  assert.equal(stage.outcome, 'computed');
  assert.equal(
    integrateSeries(first, last, [observation(first, '1'), observation(last, '3')], 1n).outcome,
    'deferred',
  );
  assert.equal(
    integrateSeries(first, last, [observation(last, '3'), observation(first, '1')], 2_000_000n)
      .outcome,
    'deferred',
  );
  assert.equal(
    integrateSeries(
      first,
      last,
      [{ ...observation(first, '1'), workflowState: 'raw' }, observation(last, '3')],
      2_000_000n,
    ).outcome,
    'deferred',
  );
  const reason = (result: ReturnType<typeof integrateSeries>) =>
    result.outcome === 'deferred' ? result.reason : null;
  assert.equal(
    reason(
      integrateSeries(first, last, [observation(first, '1'), observation(first, '3')], 2_000_000n),
    ),
    'observations_not_strictly_ordered',
  );
  assert.equal(
    reason(
      integrateSeries(
        first,
        last,
        [observation(first, '1'), { ...observation(last, '3'), sensorId: randomUUID() }],
        2_000_000n,
      ),
    ),
    'mixed_sensor_installation_or_method',
  );
  assert.equal(
    reason(
      integrateSeries(
        first,
        last,
        [observation(first, '3'), observation(last, '4')],
        2_000_000n,
        () => null,
      ),
    ),
    'stage_outside_rating_curve',
  );
  assert.equal(
    reason(
      integrateSeries(first, last, [observation(first, '-1'), observation(last, '1')], 2_000_000n),
    ),
    'negative_discharge_not_configured',
  );
  assert.equal(
    reason(integrateSeries(first, last, [observation(first, '1')], 2_000_000n)),
    'missing_exact_endpoint',
  );
});
test('governed counter delta computes exactly while unsafe transitions and coverage defer', () => {
  const start = '2026-01-01T00:00:00.000000Z';
  const end = '2026-01-01T00:00:01.000000Z';
  const counter = (observedAt: string, value: string, transition = 'normal') => ({
    ...observation(observedAt, value),
    totalizerTransition: transition,
  });
  const reason = (
    rows: ReturnType<typeof counter>[],
    approvedPolicy = true,
    maxGapMicroseconds = 2_000_000n,
  ) => {
    const result = deriveCounterInterval(start, end, rows, maxGapMicroseconds, approvedPolicy);
    assert.equal(result.outcome, 'deferred');
    return result.outcome === 'deferred' ? result.reason : null;
  };
  assert.equal(reason([], false), 'counter_policy_not_approved');
  assert.equal(reason([]), 'counter_missing_endpoint');
  assert.equal(
    reason([counter(start, '1', 'reset_reported'), counter(end, '2')]),
    'counter_reset_or_rollover',
  );
  assert.equal(
    reason([counter(start, '1'), counter(end, '2', 'rollover_reported')]),
    'counter_reset_or_rollover',
  );
  assert.equal(
    reason([
      counter(start, '1'),
      counter('2026-01-01T00:00:00.500000Z', '0', 'reset_reported'),
      counter(end, '2'),
    ]),
    'counter_reset_or_rollover',
  );
  assert.equal(
    reason([counter(start, '1', 'unknown'), counter(end, '2')]),
    'counter_reset_or_rollover',
  );
  assert.equal(reason([counter(start, '2'), counter(end, '1')]), 'counter_decrease');
  assert.equal(
    reason([counter(start, '1'), counter(end, '2')], true, 1n),
    'observation_gap_exceeds_policy',
  );
  const computed = deriveCounterInterval(
    start,
    end,
    [counter(start, '100.25'), counter(end, '103.75')],
    2_000_000n,
    true,
  );
  assert.deepEqual(computed, {
    outcome: 'computed',
    value: { numerator: 7n, denominator: 2n },
    coveredStart: start,
    coveredEnd: end,
  });
});
