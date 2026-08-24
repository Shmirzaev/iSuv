import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compatibleAlarmCatalogBinding,
  decideAlarmMaterialization,
  type AlarmCatalogBinding,
  type ConditionSignalForMaterialization,
} from './model.js';

const ruleId = '00000000-0000-4000-8000-000000000002';
const sensorId = '00000000-0000-4000-8000-000000000003';
const planId = '00000000-0000-4000-8000-000000000004';

const highStageCondition = {
  kind: 'observation_threshold' as const,
  sensorId,
  quantity: 'stage' as const,
  unit: 'm' as const,
  direction: 'high' as const,
  enter: '5',
  clear: '4',
  enterPersistenceMicroseconds: 10n,
  clearPersistenceMicroseconds: 10n,
  maxGapMicroseconds: 20n,
  uncertaintyBound: '0.1',
};
const highStage: ConditionSignalForMaterialization = {
  sourceKind: 'p4_001_rule_signal',
  ruleId,
  state: 'active',
  condition: highStageCondition,
};
const configured = (eventType: AlarmCatalogBinding['eventType']): AlarmCatalogBinding => ({
  eventType,
  ruleId,
  activationSupport: 'p4_001_rule_signal',
});

test('compatibility is a closed P4-001 map for the five usable water event families', () => {
  assert.deepEqual(compatibleAlarmCatalogBinding(configured('high_stage'), highStage), {
    compatible: true,
  });
  assert.deepEqual(
    compatibleAlarmCatalogBinding(configured('dry_canal'), {
      ...highStage,
      condition: { ...highStageCondition, direction: 'low' },
    }),
    { compatible: true },
  );
  assert.deepEqual(
    compatibleAlarmCatalogBinding(configured('over_allocation'), {
      sourceKind: 'p4_001_rule_signal',
      ruleId,
      state: 'active',
      condition: {
        kind: 'allocation_deviation',
        planId,
        direction: 'over',
        enterPersistenceMicroseconds: 10n,
        clearPersistenceMicroseconds: 10n,
        maxGapMicroseconds: 20n,
      },
    }),
    { compatible: true },
  );
  assert.deepEqual(
    compatibleAlarmCatalogBinding(configured('under_allocation'), {
      sourceKind: 'p4_001_rule_signal',
      ruleId,
      state: 'active',
      condition: {
        kind: 'allocation_deviation',
        planId,
        direction: 'under',
        enterPersistenceMicroseconds: 10n,
        clearPersistenceMicroseconds: 10n,
        maxGapMicroseconds: 20n,
      },
    }),
    { compatible: true },
  );
  assert.deepEqual(
    compatibleAlarmCatalogBinding(configured('sudden_flow_change'), {
      ...highStage,
      condition: {
        ...highStageCondition,
        quantity: 'discharge',
        unit: 'm3/s',
        rateGate: { direction: 'rise', unit: 'm3/s2', enter: '2', clear: '1' },
      },
    }),
    { compatible: true },
  );
});

test('compatibility rejects wrong conditions, unconfigured bridges, and non-rule sources', () => {
  assert.deepEqual(
    compatibleAlarmCatalogBinding(configured('high_stage'), { ...highStage, ruleId: planId }),
    {
      compatible: false,
      reason: 'incompatible_catalog_binding',
    },
  );
  assert.deepEqual(
    compatibleAlarmCatalogBinding(configured('sudden_flow_change'), {
      ...highStage,
      condition: { ...highStageCondition, quantity: 'discharge', unit: 'm3/s' },
    }),
    { compatible: false, reason: 'incompatible_catalog_binding' },
  );
  assert.deepEqual(
    compatibleAlarmCatalogBinding(
      { ...configured('high_stage'), activationSupport: 'unconfigured', ruleId: null },
      highStage,
    ),
    { compatible: false, reason: 'unconfigured_catalog' },
  );
  for (const sourceKind of [
    'p3_004_water_balance',
    'device_health',
    'data_quality',
    'unknown',
  ] as const)
    assert.deepEqual(
      compatibleAlarmCatalogBinding(configured('high_stage'), { ...highStage, sourceKind }),
      {
        compatible: false,
        reason: 'unsupported_source',
      },
    );
  assert.deepEqual(compatibleAlarmCatalogBinding(configured('network_inconsistency'), highStage), {
    compatible: false,
    reason: 'incompatible_catalog_binding',
  });
  assert.deepEqual(
    compatibleAlarmCatalogBinding(configured('under_allocation'), {
      sourceKind: 'p4_001_rule_signal',
      ruleId,
      state: 'active',
      condition: {
        kind: 'allocation_deviation',
        planId,
        direction: 'over',
        enterPersistenceMicroseconds: 10n,
        clearPersistenceMicroseconds: 10n,
        maxGapMicroseconds: 20n,
      },
    }),
    { compatible: false, reason: 'incompatible_catalog_binding' },
  );
});

const compatible = { compatible: true } as const;
const activeEpisode = { id: 'episode-1', automaticState: 'active' as const };

test('active signals create exactly one episode and then continue it', () => {
  assert.deepEqual(decideAlarmMaterialization(compatible, 'active', null), {
    outcome: 'created',
    action: 'activated',
  });
  assert.deepEqual(decideAlarmMaterialization(compatible, 'active', activeEpisode), {
    outcome: 'existing',
    action: 'continued',
  });
});

test('pending and deferred signals never create or clear an episode', () => {
  assert.deepEqual(decideAlarmMaterialization(compatible, 'pending_activation', null), {
    outcome: 'not_materialized',
    reason: 'signal_pending_activation',
  });
  assert.deepEqual(decideAlarmMaterialization(compatible, 'pending_clear', null), {
    outcome: 'not_materialized',
    reason: 'signal_pending_clear',
  });
  assert.deepEqual(decideAlarmMaterialization(compatible, 'pending_clear', activeEpisode), {
    outcome: 'existing',
    action: 'preserved_pending',
  });
  assert.deepEqual(decideAlarmMaterialization(compatible, 'deferred', activeEpisode), {
    outcome: 'existing',
    action: 'preserved_unassessable',
  });
  assert.deepEqual(decideAlarmMaterialization(compatible, 'deferred', null), {
    outcome: 'not_materialized',
    reason: 'signal_deferred',
  });
});

test('only governed inactive transition yields automatic-clear boundary for P4-003', () => {
  assert.deepEqual(decideAlarmMaterialization(compatible, 'inactive', activeEpisode), {
    outcome: 'existing',
    action: 'automatically_cleared',
  });
  assert.deepEqual(decideAlarmMaterialization(compatible, 'inactive', null), {
    outcome: 'not_materialized',
    reason: 'signal_inactive',
  });
  assert.deepEqual(
    decideAlarmMaterialization(
      { compatible: false, reason: 'unsupported_source' },
      'inactive',
      activeEpisode,
    ),
    { outcome: 'not_materialized', reason: 'unsupported_source' },
  );
});
