import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateAlarmCondition,
  rational,
  type AllocationConditionFact,
  type AlarmCondition,
  type ObservationConditionFact,
} from './model.js';

const t0 = '2030-01-01T00:00:00.000000Z';
const t10 = '2030-01-01T00:00:00.000010Z';
const t100 = '2030-01-01T00:00:00.000100Z';

const threshold: AlarmCondition = {
  kind: 'observation_threshold',
  sensorId: 'sensor-a',
  quantity: 'stage',
  unit: 'm',
  direction: 'high',
  enter: '10',
  clear: '8',
  enterPersistenceMicroseconds: 10n,
  clearPersistenceMicroseconds: 10n,
  maxGapMicroseconds: 20n,
  uncertaintyBound: '1',
  rateGate: null,
};
function observation(
  observedAt: string,
  value: bigint | null,
  overrides: Partial<ObservationConditionFact> = {},
): ObservationConditionFact {
  return {
    kind: 'observation',
    eventStart: observedAt,
    eventEnd: observedAt,
    observedAt,
    knownAt: '2030-01-01T00:01:00.000000Z',
    sourceIds: ['lineage-a'],
    revisionIds: ['revision-a'],
    policyIds: ['policy-a'],
    provenance: 'synthetic_test_fixture',
    dataClassification: 'synthetic',
    officialComplianceEligible: false,
    trusted: true,
    complete: true,
    estimated: false,
    sensorId: 'sensor-a',
    quantity: 'stage',
    unit: 'm',
    value: value === null ? null : rational(value),
    uncertainty: rational(0n),
    ratePerSecond: null,
    ...overrides,
  };
}
function allocation(
  observedAt: string,
  condition: AllocationConditionFact['condition'],
  overrides: Partial<AllocationConditionFact> = {},
): AllocationConditionFact {
  return {
    kind: 'allocation',
    eventStart: observedAt,
    eventEnd: observedAt,
    observedAt,
    knownAt: '2030-01-01T00:01:00.000000Z',
    sourceIds: ['entry-a'],
    revisionIds: ['revision-a'],
    policyIds: ['tolerance-a'],
    provenance: 'synthetic_p3_003_fixture',
    dataClassification: 'synthetic',
    officialComplianceEligible: false,
    trusted: true,
    complete: true,
    estimated: false,
    planId: 'plan-a',
    outcome: condition === 'unassessable' ? 'unassessable' : 'computed',
    condition,
    value: rational(1n),
    uncertainty: null,
    ...overrides,
  };
}

test('a valid single threshold spike is pending, while missing/invalid data is deferred', () => {
  assert.equal(
    evaluateAlarmCondition(threshold, [observation(t0, 11n)]).state,
    'pending_activation',
  );
  const invalid = evaluateAlarmCondition(threshold, [observation(t0, null)]);
  assert.equal(invalid.state, 'deferred');
  assert.equal(invalid.reason, 'unknown_uncertainty');
  assert.equal(
    evaluateAlarmCondition(threshold, [observation(t0, 11n, { estimated: true })]).reason,
    'estimated_fact',
  );
});

test('sustained exact high threshold activation needs two contiguous facts and persistence', () => {
  const result = evaluateAlarmCondition(threshold, [observation(t0, 10n), observation(t10, 10n)]);
  assert.equal(result.state, 'inactive', 'equality at enter is never a breach');
  const active = evaluateAlarmCondition(threshold, [observation(t0, 11n), observation(t10, 11n)]);
  assert.equal(active.state, 'active');
  assert.equal(active.evidence.qualifyingDurationMicroseconds, 10n);
  assert.equal(active.evidence.qualifyingFactCount, 2);
  assert.equal(active.evidence.facts[0]?.dataClassification, 'synthetic');
});

test('upper hysteresis, persisted clear, chatter, and a max-gap reset are deterministic', () => {
  assert.equal(
    evaluateAlarmCondition(threshold, [observation(t0, 9n)], 'active').state,
    'active',
    'between clear and enter remains active',
  );
  assert.equal(
    evaluateAlarmCondition(threshold, [observation(t0, 8n)], 'active').state,
    'pending_clear',
  );
  assert.equal(
    evaluateAlarmCondition(threshold, [observation(t0, 8n), observation(t10, 11n)], 'active').state,
    'active',
    'a breach interrupts clear persistence',
  );
  assert.equal(
    evaluateAlarmCondition(threshold, [observation(t0, 8n), observation(t10, 8n)], 'active').state,
    'inactive',
  );
  const gapped = evaluateAlarmCondition(threshold, [observation(t0, 11n), observation(t100, 11n)]);
  assert.equal(gapped.state, 'pending_activation');
  assert.equal(gapped.evidence.gapBroken, true);
});

test('low thresholds use symmetric uncertainty-safe comparisons', () => {
  const low: AlarmCondition = { ...threshold, direction: 'low', enter: '3', clear: '5' };
  assert.equal(
    evaluateAlarmCondition(low, [observation(t0, 3n), observation(t10, 3n)]).state,
    'inactive',
    'equality at a low enter is never a breach',
  );
  const active = evaluateAlarmCondition(low, [observation(t0, 2n), observation(t10, 2n)]);
  assert.equal(active.state, 'active');
  assert.equal(
    evaluateAlarmCondition(low, [observation(t0, 5n), observation(t10, 5n)], 'active').state,
    'inactive',
    'equality at clear safely clears',
  );
});

test('rate gates are exact and unit/identity mismatches defer without a false clear', () => {
  const gated: AlarmCondition = {
    ...threshold,
    rateGate: { direction: 'rise', unit: 'm/s', enter: '2', clear: '1' },
  };
  const equality = evaluateAlarmCondition(gated, [
    observation(t0, 11n, { ratePerSecond: rational(2n) }),
  ]);
  assert.equal(equality.state, 'inactive');
  assert.equal(equality.reason, 'rate_gate_not_met');
  assert.equal(
    evaluateAlarmCondition(gated, [
      observation(t0, 11n, { ratePerSecond: rational(3n) }),
      observation(t10, 11n, { ratePerSecond: rational(3n) }),
    ]).state,
    'active',
  );
  assert.equal(
    evaluateAlarmCondition(threshold, [observation(t0, 8n, { unit: 'm3/s' })], 'active').state,
    'deferred',
  );
  assert.equal(
    evaluateAlarmCondition(threshold, [
      observation(t0, 11n),
      observation('2030-01-01T05:00:00.000000+05:00', 11n),
    ]).reason,
    'duplicate_or_nonmonotonic',
  );
});

test('allocation rules consume governed P3-003 classifications and defer unassessable facts', () => {
  const rule: AlarmCondition = {
    kind: 'allocation_deviation',
    planId: 'plan-a',
    direction: 'over',
    enterPersistenceMicroseconds: 10n,
    clearPersistenceMicroseconds: 10n,
    maxGapMicroseconds: 20n,
  };
  assert.equal(
    evaluateAlarmCondition(rule, [allocation(t0, 'over'), allocation(t10, 'over')]).state,
    'active',
  );
  assert.equal(
    evaluateAlarmCondition(rule, [allocation(t0, 'unassessable')], 'active').reason,
    'allocation_unassessable',
  );
  assert.equal(
    evaluateAlarmCondition(rule, [allocation(t0, 'within'), allocation(t10, 'within')], 'active')
      .state,
    'inactive',
  );
});
