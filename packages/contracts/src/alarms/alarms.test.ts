import assert from 'node:assert/strict';
import test from 'node:test';
import {
  alarmCatalogReadResponseSchema,
  alarmEventTypeSchema,
  alarmMaterializationResultSchema,
  createAlarmCatalogRequestSchema,
  materializeAlarmRequestSchema,
  requestAlarmCatalogVersionRequestSchema,
  systemDeviceConditionSchema,
  waterConditionSchema,
} from './alarms.js';

const territoryId = '00000000-0000-4000-8000-000000000001';
const ruleId = '00000000-0000-4000-8000-000000000002';
const catalogId = '00000000-0000-4000-8000-000000000003';
const versionId = '00000000-0000-4000-8000-000000000004';
const userId = '00000000-0000-4000-8000-000000000005';
const runId = '00000000-0000-4000-8000-000000000006';
const alarmId = '00000000-0000-4000-8000-000000000007';
const at = '2026-08-24T00:00:00.000001Z';

test('alarm catalog has exactly the twelve required event families', () => {
  assert.deepEqual(alarmEventTypeSchema.options, [
    'over_allocation',
    'under_allocation',
    'unexplained_balance',
    'sudden_flow_change',
    'high_stage',
    'dry_canal',
    'sensor_frozen',
    'sensor_impossible',
    'communication_loss',
    'power_problem',
    'calibration_overdue',
    'network_inconsistency',
  ]);
  assert.equal(alarmEventTypeSchema.safeParse('allocation_deviation').success, false);
  assert.deepEqual(waterConditionSchema.options, [
    'over_allocation',
    'under_allocation',
    'high_stage',
    'dry_canal',
    'sudden_flow_change',
    'unexplained_balance',
    'not_assessed',
    'unassessable',
  ]);
  assert.deepEqual(systemDeviceConditionSchema.options, [
    'sensor_frozen',
    'sensor_impossible',
    'communication_loss',
    'power_problem',
    'calibration_overdue',
    'network_inconsistency',
    'not_assessed',
    'unconfigured',
    'unassessable',
  ]);
});

test('catalog authoring is strict and version bindings explicitly state support', () => {
  assert.equal(
    createAlarmCatalogRequestSchema.safeParse({
      territoryId,
      eventType: 'high_stage',
      title: 'High stage',
      provenance: 'synthetic fixture',
      reason: 'initial catalog',
    }).success,
    true,
  );
  assert.equal(
    createAlarmCatalogRequestSchema.safeParse({
      territoryId,
      eventType: 'high_stage',
      title: 'High stage',
      provenance: 'synthetic fixture',
      reason: 'initial catalog',
      severity: 'critical',
    }).success,
    false,
  );
  const base = {
    effectiveFrom: at,
    effectiveUntil: '2026-08-24T01:00:00.000001Z',
    ruleId,
    activationSupport: 'p4_001_rule_signal' as const,
    waterCondition: 'high_stage' as const,
    systemDeviceCondition: 'not_assessed' as const,
    severity: 'warning' as const,
    provenance: 'synthetic fixture',
    reason: 'governed fixture',
  };
  assert.equal(requestAlarmCatalogVersionRequestSchema.safeParse(base).success, true);
  assert.equal(
    requestAlarmCatalogVersionRequestSchema.safeParse({ ...base, effectiveUntil: at }).success,
    false,
  );
  assert.equal(
    requestAlarmCatalogVersionRequestSchema.safeParse({ ...base, ruleId: null }).success,
    false,
  );
  assert.equal(
    requestAlarmCatalogVersionRequestSchema.safeParse({
      ...base,
      activationSupport: 'unconfigured',
      ruleId: null,
    }).success,
    true,
  );
  assert.equal(
    requestAlarmCatalogVersionRequestSchema.safeParse({
      ...base,
      activationSupport: 'unconfigured',
    }).success,
    false,
  );
  assert.equal(
    requestAlarmCatalogVersionRequestSchema.safeParse({ ...base, knownAt: at }).success,
    false,
  );
});

test('materialization caller can select only a governed rule and exact UTC cutoffs', () => {
  const request = { ruleId, effectiveAt: at, knownAt: '2026-08-24T00:01:00.000001Z' };
  assert.equal(materializeAlarmRequestSchema.safeParse(request).success, true);
  assert.equal(
    materializeAlarmRequestSchema.safeParse({ ...request, severity: 'critical' }).success,
    false,
  );
  assert.equal(
    materializeAlarmRequestSchema.safeParse({ ...request, eventType: 'high_stage' }).success,
    false,
  );
  assert.equal(
    materializeAlarmRequestSchema.safeParse({ ...request, automaticState: 'active' }).success,
    false,
  );
  assert.equal(
    materializeAlarmRequestSchema.safeParse({ ...request, knownAt: '2026-08-24T00:01:00.0000001Z' })
      .success,
    false,
  );
});

const episode = {
  id: alarmId,
  organizationId: territoryId,
  territoryId,
  eventType: 'high_stage' as const,
  waterCondition: 'high_stage' as const,
  systemDeviceCondition: 'not_assessed' as const,
  severity: 'warning' as const,
  automaticState: 'active' as const,
  catalogId,
  catalogVersionId: versionId,
  ruleId,
  ruleVersionId: versionId,
  activationSignalRunId: runId,
  latestSignalRunId: runId,
  activationEvidence: [runId],
  provenance: 'synthetic fixture',
  detectedAt: at,
  effectiveAt: at,
  knownAt: at,
  clearedAt: null,
  clearSignalRunId: null,
  dataClassification: 'synthetic' as const,
  officialComplianceEligible: false as const,
};

test('materialization output is a strict typed automatic episode outcome', () => {
  assert.equal(
    alarmMaterializationResultSchema.safeParse({
      outcome: 'created',
      action: 'activated',
      alarm: episode,
      reason: null,
    }).success,
    true,
  );
  assert.equal(
    alarmMaterializationResultSchema.safeParse({
      outcome: 'existing',
      action: 'automatically_cleared',
      alarm: { ...episode, automaticState: 'cleared', clearedAt: at, clearSignalRunId: runId },
      reason: null,
    }).success,
    true,
  );
  assert.equal(
    alarmMaterializationResultSchema.safeParse({
      outcome: 'not_materialized',
      action: null,
      alarm: null,
      reason: 'signal_deferred',
    }).success,
    true,
  );
  assert.equal(
    alarmMaterializationResultSchema.safeParse({
      outcome: 'created',
      action: 'acknowledged',
      alarm: episode,
      reason: null,
    }).success,
    false,
  );
  assert.equal(
    alarmMaterializationResultSchema.safeParse({
      outcome: 'created',
      action: 'activated',
      alarm: { ...episode, dataClassification: 'official' },
      reason: null,
    }).success,
    false,
  );
});

test('read contract preserves bitemporal unconfigured state instead of normalizing it', () => {
  assert.equal(
    alarmCatalogReadResponseSchema.safeParse({
      resolution: 'unconfigured',
      effectiveAt: at,
      knownAt: at,
      catalogVersion: null,
      reason: 'source_bridge_unconfigured',
    }).success,
    true,
  );
  assert.equal(
    alarmCatalogReadResponseSchema.safeParse({
      resolution: 'unconfigured',
      effectiveAt: at,
      knownAt: at,
      catalogVersion: null,
      reason: 'normal',
    }).success,
    false,
  );
  assert.equal(userId.length, 36);
});
