import type { AlarmIncidentCenterItem, AlarmIncidentCenterQuery } from '@isuv/contracts';

import type { Locale, TranslationKey } from '@isuv/i18n';
import { formatDecimal } from './format.js';

export type AlarmCenterSelection = { alarmId: string | null; incidentId: string | null };
export type AlarmCenterFilters = Pick<
  AlarmIncidentCenterQuery,
  | 'automaticState'
  | 'incidentStatus'
  | 'severity'
  | 'eventType'
  | 'waterCondition'
  | 'systemDeviceCondition'
  | 'assignment'
  | 'evidenceAssessment'
>;

const uuid = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i;
const filterKeys = [
  'automaticState',
  'incidentStatus',
  'severity',
  'eventType',
  'waterCondition',
  'systemDeviceCondition',
  'assignment',
  'evidenceAssessment',
] as const satisfies readonly (keyof AlarmCenterFilters)[];

export const emptyAlarmCenterFilters: AlarmCenterFilters = {};

/** A panel always has one authoritative selector; a forged dual selector is ignored. */
export function alarmCenterSelectionFromHash(hash: string): AlarmCenterSelection {
  const [area, query] = hash.replace(/^#/, '').split('?', 2);
  if (area !== 'alarms') return { alarmId: null, incidentId: null };
  const params = new URLSearchParams(query ?? '');
  const alarmId = params.get('alarmId');
  const incidentId = params.get('incidentId');
  if (incidentId && uuid.test(incidentId)) return { alarmId: null, incidentId };
  if (alarmId && uuid.test(alarmId)) return { alarmId, incidentId: null };
  return { alarmId: null, incidentId: null };
}

export function alarmCenterHash(selection: AlarmCenterSelection): string {
  if (selection.incidentId) return `#alarms?incidentId=${encodeURIComponent(selection.incidentId)}`;
  if (selection.alarmId) return `#alarms?alarmId=${encodeURIComponent(selection.alarmId)}`;
  return '#alarms';
}

export function alarmCenterPath(
  filters: AlarmCenterFilters,
  selection: AlarmCenterSelection,
  cursor?: string | null,
): string {
  const search = new URLSearchParams();
  for (const key of filterKeys) {
    const value = filters[key];
    if (value) search.set(key, value);
  }
  if (selection.incidentId) search.set('incidentId', selection.incidentId);
  else if (selection.alarmId) search.set('alarmId', selection.alarmId);
  if (cursor) search.set('cursor', cursor);
  search.set('limit', '25');
  return `/api/v1/alarm-incident-center?${search.toString()}`;
}

export function selectionForAlarmCenterItem(item: AlarmIncidentCenterItem): AlarmCenterSelection {
  return item.incidentId
    ? { alarmId: null, incidentId: item.incidentId }
    : { alarmId: item.alarmId, incidentId: null };
}

export function formatAlarmCenterTimestamp(value: string | null): string {
  return value ? value.replace('T', ' ').replace('Z', ' UTC') : '—';
}

/** Keep the database-owned integer visible rather than presenting a rounded SLA value. */
export function formatAlarmCenterMicros(value: string | null, locale: Locale = 'en'): string {
  return value === null ? '—' : `${formatDecimal(locale, value)} µs`;
}

type Presentation = { icon: string; label: TranslationKey; value: TranslationKey };

export function severityPresentation(severity: AlarmIncidentCenterItem['severity']): Presentation {
  const values: Record<AlarmIncidentCenterItem['severity'], Presentation> = {
    information: {
      icon: 'ℹ',
      label: 'alarmSeverityInformation',
      value: 'alarmSeverityInformationValue',
    },
    advisory: { icon: '!', label: 'alarmSeverityAdvisory', value: 'alarmSeverityAdvisoryValue' },
    warning: { icon: '⚠', label: 'alarmSeverityWarning', value: 'alarmSeverityWarningValue' },
    critical: { icon: '‼', label: 'alarmSeverityCritical', value: 'alarmSeverityCriticalValue' },
  };
  return values[severity];
}

export function automaticStatePresentation(
  state: AlarmIncidentCenterItem['automaticState'],
): Presentation {
  return state === 'active'
    ? { icon: '◉', label: 'alarmAutomaticActive', value: 'alarmAutomaticActiveValue' }
    : { icon: '✓', label: 'alarmAutomaticCleared', value: 'alarmAutomaticClearedValue' };
}

export function incidentStatePresentation(
  state: AlarmIncidentCenterItem['incidentStatus'],
): Presentation {
  const values: Record<NonNullable<AlarmIncidentCenterItem['incidentStatus']>, Presentation> = {
    open: { icon: '○', label: 'incidentOpen', value: 'incidentOpenValue' },
    acknowledged: { icon: '✓', label: 'incidentAcknowledged', value: 'incidentAcknowledgedValue' },
    investigating: {
      icon: '⌕',
      label: 'incidentInvestigating',
      value: 'incidentInvestigatingValue',
    },
    resolved: { icon: '✓', label: 'incidentResolved', value: 'incidentResolvedValue' },
    closed: { icon: '■', label: 'incidentClosed', value: 'incidentClosedValue' },
  };
  return state
    ? values[state]
    : { icon: '—', label: 'incidentNotCreated', value: 'incidentNotCreatedValue' };
}

export function evidencePresentation(
  assessment: AlarmIncidentCenterItem['evidence']['assessment'],
): Presentation {
  const values: Record<AlarmIncidentCenterItem['evidence']['assessment'], Presentation> = {
    assessable: {
      icon: '✓',
      label: 'alarmEvidenceAssessable',
      value: 'alarmEvidenceAssessableValue',
    },
    unassessable: {
      icon: '!',
      label: 'alarmEvidenceUnassessable',
      value: 'alarmEvidenceUnassessableValue',
    },
    missing: { icon: '—', label: 'alarmEvidenceMissing', value: 'alarmEvidenceMissingValue' },
    pending: { icon: '◌', label: 'alarmEvidencePending', value: 'alarmEvidencePendingValue' },
    deferred: { icon: '↷', label: 'alarmEvidenceDeferred', value: 'alarmEvidenceDeferredValue' },
  };
  return values[assessment];
}

export function waterConditionKey(
  value: AlarmIncidentCenterItem['waterCondition'],
): TranslationKey {
  const values: Record<AlarmIncidentCenterItem['waterCondition'], TranslationKey> = {
    over_allocation: 'alarmWaterOverAllocation',
    under_allocation: 'alarmWaterUnderAllocation',
    high_stage: 'alarmWaterHighStage',
    dry_canal: 'alarmWaterDryCanal',
    sudden_flow_change: 'alarmWaterSuddenFlowChange',
    unexplained_balance: 'alarmWaterUnexplainedBalance',
    not_assessed: 'alarmConditionNotAssessed',
    unassessable: 'alarmConditionUnassessable',
  };
  return values[value];
}

export function systemConditionKey(
  value: AlarmIncidentCenterItem['systemDeviceCondition'],
): TranslationKey {
  const values: Record<AlarmIncidentCenterItem['systemDeviceCondition'], TranslationKey> = {
    sensor_frozen: 'alarmSystemSensorFrozen',
    sensor_impossible: 'alarmSystemSensorImpossible',
    communication_loss: 'alarmSystemCommunicationLoss',
    power_problem: 'alarmSystemPowerProblem',
    calibration_overdue: 'alarmSystemCalibrationOverdue',
    network_inconsistency: 'alarmSystemNetworkInconsistency',
    not_assessed: 'alarmConditionNotAssessed',
    unconfigured: 'alarmConditionUnconfigured',
    unassessable: 'alarmConditionUnassessable',
  };
  return values[value];
}

export function eventTypeKey(value: AlarmIncidentCenterItem['eventType']): TranslationKey {
  const values: Record<AlarmIncidentCenterItem['eventType'], TranslationKey> = {
    over_allocation: 'alarmEventOverAllocation',
    under_allocation: 'alarmEventUnderAllocation',
    unexplained_balance: 'alarmEventUnexplainedBalance',
    sudden_flow_change: 'alarmEventSuddenFlowChange',
    high_stage: 'alarmEventHighStage',
    dry_canal: 'alarmEventDryCanal',
    sensor_frozen: 'alarmEventSensorFrozen',
    sensor_impossible: 'alarmEventSensorImpossible',
    communication_loss: 'alarmEventCommunicationLoss',
    power_problem: 'alarmEventPowerProblem',
    calibration_overdue: 'alarmEventCalibrationOverdue',
    network_inconsistency: 'alarmEventNetworkInconsistency',
  };
  return values[value];
}

export function metricStateKey(value: string): TranslationKey {
  const values: Record<string, TranslationKey> = {
    unconfigured: 'alarmMetricUnconfigured',
    acknowledgement_pending: 'alarmMetricAcknowledgementPending',
    acknowledgement_overdue: 'alarmMetricAcknowledgementOverdue',
    acknowledgement_met: 'alarmMetricAcknowledgementMet',
    resolution_pending: 'alarmMetricResolutionPending',
    resolution_overdue: 'alarmMetricResolutionOverdue',
    resolution_met: 'alarmMetricResolutionMet',
  };
  return values[value] ?? 'notAvailable';
}

export function unitBoundaryKey(
  value: AlarmIncidentCenterItem['evidence']['unitBoundary'],
): TranslationKey {
  const values: Record<AlarmIncidentCenterItem['evidence']['unitBoundary'], TranslationKey> = {
    stage_m: 'alarmUnitStage',
    discharge_m3s: 'alarmUnitDischarge',
    volume_m3: 'alarmUnitVolume',
    not_applicable: 'alarmUnitNotApplicable',
  };
  return values[value];
}

export function evidenceQualityKey(
  value: AlarmIncidentCenterItem['evidence']['qualityState'],
): TranslationKey {
  const values: Record<AlarmIncidentCenterItem['evidence']['qualityState'], TranslationKey> = {
    valid: 'qualityValid',
    estimated: 'liveQualityEstimated',
    unknown: 'liveQualityUnknown',
    unavailable: 'alarmQualityUnavailable',
  };
  return values[value];
}

const capabilityReasonKeys: Readonly<Record<string, TranslationKey>> = {
  'Incident write authority is not granted for this territory.': 'alarmCapabilityNoWrite',
  'An incident already exists for this alarm.': 'alarmCapabilityExistingIncident',
  'Only open incidents can be acknowledged.': 'alarmCapabilityAcknowledgeState',
  'Only acknowledged incidents can be investigated.': 'alarmCapabilityInvestigateState',
  'Closed or absent incidents cannot be assigned.': 'alarmCapabilityAssignState',
  'Closed or absent incidents cannot receive comments.': 'alarmCapabilityCommentState',
  'Closed or absent incidents cannot receive corrective actions.': 'alarmCapabilityCorrectiveState',
  'Investigation and automatic clear are required.': 'alarmCapabilityResolveState',
  'Resolution and automatic clear are required.': 'alarmCapabilityCloseState',
};

const actionErrorKeys: Readonly<Record<string, TranslationKey>> = {
  'The incident conflicts with governed history.': 'alarmApiConflict',
  'The incident input is invalid.': 'alarmApiInvalid',
  'Incident was not found.': 'alarmApiNotFound',
  'Assignee is not active or lacks incident authority.': 'alarmApiInvalidAssignee',
  'The metric cutoff cannot precede incident creation.': 'alarmApiMetricCutoff',
  'Incident is invalid.': 'alarmApiInvalid',
  'Incident action is invalid.': 'alarmApiInvalidAction',
  'Incident alarm link is invalid.': 'alarmApiInvalidAction',
  'Incident assignment is invalid.': 'alarmApiInvalidAssignee',
  'Incident note is invalid.': 'alarmApiInvalidAction',
  'Authentication is required.': 'alarmApiUnauthenticated',
};

export function capabilityDisabledReasonKey(reason: string | null): TranslationKey | null {
  return reason ? (capabilityReasonKeys[reason] ?? null) : null;
}

export function actionErrorKey(message: string): TranslationKey | null {
  return actionErrorKeys[message] ?? null;
}
