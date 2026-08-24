import assert from 'node:assert/strict';
import test from 'node:test';
import {
  alarmConditionFactSchema,
  alarmConditionSchema,
  alarmRuleEvaluationResponseSchema,
  createAlarmRuleRequestSchema,
  requestAlarmRuleVersionRequestSchema,
} from './alarm-rules.js';

const ids = {
  territory: '00000000-0000-4000-8000-000000000001',
  sensor: '00000000-0000-4000-8000-000000000002',
  plan: '00000000-0000-4000-8000-000000000003',
  source: '00000000-0000-4000-8000-000000000004',
  revision: '00000000-0000-4000-8000-000000000005',
  policy: '00000000-0000-4000-8000-000000000006',
  rule: '00000000-0000-4000-8000-000000000007',
  version: '00000000-0000-4000-8000-000000000008',
};
const condition = {
  kind: 'observation_threshold' as const,
  sensorId: ids.sensor,
  quantity: 'stage' as const,
  unit: 'm' as const,
  direction: 'high' as const,
  enter: '2.5',
  clear: '2.0',
  enterPersistenceMicroseconds: '1000000',
  clearPersistenceMicroseconds: '1000000',
  maxGapMicroseconds: '2000000',
  uncertaintyBound: '0.1',
  rateGate: { direction: 'rise' as const, unit: 'm/s' as const, enter: '0.2', clear: '0.1' },
};
const fact = {
  kind: 'observation' as const,
  eventStart: '2030-01-01T00:00:00.000000Z',
  eventEnd: '2030-01-01T00:00:00.000000Z',
  observedAt: '2030-01-01T05:00:00.000000+05:00',
  knownAt: '2030-01-01T00:01:00.000000Z',
  sourceIds: [ids.source],
  revisionIds: [ids.revision],
  policyIds: [ids.policy],
  trusted: true,
  complete: true,
  estimated: false,
  provenance: 'synthetic_fixture',
  dataClassification: 'synthetic' as const,
  officialComplianceEligible: false as const,
  sensorId: ids.sensor,
  quantity: 'stage' as const,
  unit: 'm' as const,
  value: { numerator: '26', denominator: '10' },
  uncertainty: { numerator: '1', denominator: '10' },
  ratePerSecond: { numerator: '3', denominator: '10' },
};

test('alarm rule contracts bind immutable subject identity and reject policy fields outside scope', () => {
  assert.equal(
    createAlarmRuleRequestSchema.safeParse({
      territoryId: ids.territory,
      subjectKind: 'observation_sensor',
      subjectId: ids.sensor,
      provenance: 'synthetic_fixture',
      reason: 'Create a test policy.',
    }).success,
    true,
  );
  assert.equal(
    createAlarmRuleRequestSchema.safeParse({
      territoryId: ids.territory,
      provenance: 'x',
      reason: 'x',
    }).success,
    false,
  );
  assert.equal(
    alarmConditionSchema.safeParse({ ...condition, severity: 'critical' }).success,
    false,
  );
});

test('threshold contract strictly validates hysteresis, units, rate units, and bounded durations', () => {
  assert.equal(alarmConditionSchema.safeParse(condition).success, true);
  assert.equal(alarmConditionSchema.safeParse({ ...condition, clear: '2.5' }).success, false);
  assert.equal(alarmConditionSchema.safeParse({ ...condition, unit: 'm3/s' }).success, false);
  assert.equal(
    alarmConditionSchema.safeParse({
      ...condition,
      rateGate: { ...condition.rateGate, unit: 'm3/s2' },
    }).success,
    false,
  );
  assert.equal(
    alarmConditionSchema.safeParse({ ...condition, enterPersistenceMicroseconds: '0' }).success,
    false,
  );
  assert.equal(
    alarmConditionSchema.safeParse({ ...condition, maxGapMicroseconds: '31536000000001' }).success,
    false,
  );
});

test('version and exact fact contracts preserve microsecond UTC/bitemporal and source evidence', () => {
  assert.equal(
    requestAlarmRuleVersionRequestSchema.safeParse({
      effectiveFrom: '2030-01-01T00:00:00.000000Z',
      effectiveUntil: '2030-01-01T05:00:00.000001+05:00',
      condition,
      provenance: 'synthetic_fixture',
      reason: 'Version test rule.',
    }).success,
    true,
  );
  assert.equal(
    requestAlarmRuleVersionRequestSchema.safeParse({
      effectiveFrom: '2030-01-01T00:00:00.000001Z',
      effectiveUntil: '2030-01-01T05:00:00.000001+05:00',
      condition,
      provenance: 'synthetic_fixture',
      reason: 'Offset-equivalent instants are not ordered.',
    }).success,
    false,
  );
  assert.equal(alarmConditionFactSchema.safeParse(fact).success, true);
  assert.equal(alarmConditionFactSchema.safeParse({ ...fact, sourceIds: [] }).success, false);
  assert.equal(
    alarmConditionFactSchema.safeParse({
      ...fact,
      kind: 'allocation',
      planId: ids.plan,
      outcome: 'unassessable',
      condition: 'over',
    }).success,
    false,
  );
});

test('typed evaluation output remains synthetic/non-official and exposes exact evidence fields', () => {
  assert.equal(
    alarmRuleEvaluationResponseSchema.safeParse({
      evaluation: {
        ruleId: ids.rule,
        versionId: ids.version,
        effectiveAt: '2030-01-01T00:00:00.000000Z',
        knownAt: '2030-01-01T00:01:00.000000Z',
        state: 'pending_activation',
        reason: null,
        qualifyingStart: fact.observedAt,
        qualifyingEnd: fact.observedAt,
        qualifyingDurationMicroseconds: '0',
        qualifyingFactCount: 1,
        evidence: [fact],
        dataClassification: 'synthetic',
        officialComplianceEligible: false,
        alarmEligible: false,
      },
    }).success,
    true,
  );
});
