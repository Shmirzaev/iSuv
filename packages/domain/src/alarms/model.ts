import type { AlarmCondition, ConditionState } from '../alarm-rules/model.js';

export type AlarmCatalogEventType =
  | 'over_allocation'
  | 'under_allocation'
  | 'unexplained_balance'
  | 'sudden_flow_change'
  | 'high_stage'
  | 'dry_canal'
  | 'sensor_frozen'
  | 'sensor_impossible'
  | 'communication_loss'
  | 'power_problem'
  | 'calibration_overdue'
  | 'network_inconsistency';
export type AlarmActivationSupport = 'p4_001_rule_signal' | 'unconfigured';
export type AlarmMaterializationReason =
  | 'unconfigured_catalog'
  | 'unsupported_source'
  | 'incompatible_catalog_binding'
  | 'signal_deferred'
  | 'signal_pending_activation'
  | 'signal_pending_clear'
  | 'signal_inactive'
  | 'no_active_alarm_episode';

export interface AlarmCatalogBinding {
  eventType: AlarmCatalogEventType;
  ruleId: string | null;
  activationSupport: AlarmActivationSupport;
}

/** Sources are explicit so balance, device, and data-quality paths cannot masquerade as a P4-001 rule. */
export type AlarmSourceKind =
  'p4_001_rule_signal' | 'p3_004_water_balance' | 'device_health' | 'data_quality' | 'unknown';
export interface ConditionSignalForMaterialization {
  sourceKind: AlarmSourceKind;
  ruleId: string;
  condition: AlarmCondition;
  state: ConditionState;
}
export type AlarmCatalogCompatibility =
  | { compatible: true }
  | {
      compatible: false;
      reason: 'unconfigured_catalog' | 'unsupported_source' | 'incompatible_catalog_binding';
    };

/**
 * Compatibility is deliberately a closed map.  The rule engine knows condition
 * mechanics; the catalog owns operator event labels.  No balance, device, or
 * validation condition gains alarm authority merely by sharing a severity name.
 */
export function compatibleAlarmCatalogBinding(
  binding: AlarmCatalogBinding | null,
  signal: ConditionSignalForMaterialization,
): AlarmCatalogCompatibility {
  if (!binding || binding.activationSupport === 'unconfigured' || !binding.ruleId)
    return { compatible: false, reason: 'unconfigured_catalog' };
  if (signal.sourceKind !== 'p4_001_rule_signal')
    return { compatible: false, reason: 'unsupported_source' };
  if (binding.ruleId !== signal.ruleId)
    return { compatible: false, reason: 'incompatible_catalog_binding' };

  const { condition } = signal;
  if (
    binding.eventType === 'over_allocation' &&
    condition.kind === 'allocation_deviation' &&
    condition.direction === 'over'
  )
    return { compatible: true };
  if (
    binding.eventType === 'under_allocation' &&
    condition.kind === 'allocation_deviation' &&
    condition.direction === 'under'
  )
    return { compatible: true };
  if (
    binding.eventType === 'high_stage' &&
    condition.kind === 'observation_threshold' &&
    condition.quantity === 'stage' &&
    condition.unit === 'm' &&
    condition.direction === 'high'
  )
    return { compatible: true };
  if (
    binding.eventType === 'dry_canal' &&
    condition.kind === 'observation_threshold' &&
    ((condition.quantity === 'stage' && condition.unit === 'm') ||
      (condition.quantity === 'discharge' && condition.unit === 'm3/s')) &&
    condition.direction === 'low'
  )
    return { compatible: true };
  if (
    binding.eventType === 'sudden_flow_change' &&
    condition.kind === 'observation_threshold' &&
    condition.quantity === 'discharge' &&
    condition.unit === 'm3/s' &&
    condition.rateGate
  )
    return { compatible: true };
  return { compatible: false, reason: 'incompatible_catalog_binding' };
}

export interface ActiveAlarmEpisode {
  id: string;
  automaticState: 'active';
}
export type AlarmMaterializationDecision =
  | { outcome: 'created'; action: 'activated' }
  | {
      outcome: 'existing';
      action:
        'continued' | 'preserved_pending' | 'preserved_unassessable' | 'automatically_cleared';
    }
  | { outcome: 'not_materialized'; reason: AlarmMaterializationReason };

/**
 * Pure episode boundary for the persistence layer.  It cannot acknowledge,
 * assign, comment, resolve, escalate, notify, create incidents, or control OT.
 */
export function decideAlarmMaterialization(
  compatibility: AlarmCatalogCompatibility,
  signalState: ConditionState,
  existingActiveEpisode: ActiveAlarmEpisode | null,
): AlarmMaterializationDecision {
  if (!compatibility.compatible)
    return { outcome: 'not_materialized', reason: compatibility.reason };
  if (signalState === 'deferred') {
    if (existingActiveEpisode) return { outcome: 'existing', action: 'preserved_unassessable' };
    return { outcome: 'not_materialized', reason: 'signal_deferred' };
  }
  if (signalState === 'pending_activation') {
    if (existingActiveEpisode) return { outcome: 'existing', action: 'preserved_pending' };
    return { outcome: 'not_materialized', reason: 'signal_pending_activation' };
  }
  if (signalState === 'pending_clear') {
    if (existingActiveEpisode) return { outcome: 'existing', action: 'preserved_pending' };
    return { outcome: 'not_materialized', reason: 'signal_pending_clear' };
  }
  if (signalState === 'active') {
    if (existingActiveEpisode) return { outcome: 'existing', action: 'continued' };
    return { outcome: 'created', action: 'activated' };
  }
  if (existingActiveEpisode) return { outcome: 'existing', action: 'automatically_cleared' };
  return { outcome: 'not_materialized', reason: 'signal_inactive' };
}
