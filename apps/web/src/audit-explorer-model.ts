import {
  auditActionSchema,
  auditResourceSchema,
  type AuditEvent,
  type ListAuditEventsQuery,
} from '@isuv/contracts';
import type { TranslationKey } from '@isuv/i18n';

type AuditAction = AuditEvent['action'];
type AuditResource = AuditEvent['resource'];

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const auditResources: readonly AuditResource[] = auditResourceSchema.options;
export const auditActions: readonly AuditAction[] = auditActionSchema.options;

export type AuditActionGroup =
  | 'identity'
  | 'observations'
  | 'validation'
  | 'allocations'
  | 'quantityModels'
  | 'tolerances'
  | 'waterBalance'
  | 'alarms'
  | 'incidents'
  | 'escalation'
  | 'maintenance'
  | 'reports';

const auditActionGroups: readonly [AuditActionGroup, readonly AuditAction[]][] = [
  ['identity', ['user_role_grant.created', 'user_role_grant.revoked', 'user_role_grant.cancelled']],
  [
    'observations',
    [
      'observation.corrected',
      'observation.rejected',
      'observation.estimated',
      'observation.automatically_validated',
    ],
  ],
  [
    'validation',
    [
      'validation_profile.created',
      'validation_profile_version.created',
      'validation_profile_version.approved',
    ],
  ],
  [
    'allocations',
    [
      'allocation_plan.created',
      'allocation_plan_version.created',
      'allocation_plan_version.requested',
      'allocation_plan_version.approved',
      'allocation_plan_version.superseded',
      'allocation_plan_entry.created',
      'allocation_plan_entry_measurement_binding.created',
    ],
  ],
  ['quantityModels', ['rating_curve.created', 'rating_curve_version.approved']],
  [
    'tolerances',
    [
      'integration_coverage_policy.created',
      'integration_coverage_policy_version.approved',
      'section_tolerance_policy.created',
      'section_tolerance_policy_version.requested',
      'section_tolerance_policy_version.approved',
    ],
  ],
  [
    'waterBalance',
    [
      'water_balance_model.created',
      'water_balance_version.requested',
      'water_balance_version.approved',
      'water_balance_component.created',
      'water_balance_assumption.created',
    ],
  ],
  [
    'alarms',
    [
      'alarm_rule.created',
      'alarm_rule_version.requested',
      'alarm_rule_version.approved',
      'alarm_catalog.created',
      'alarm_catalog_policy.requested',
      'alarm_catalog_policy.approved',
      'alarm.created',
      'alarm.cleared',
    ],
  ],
  [
    'incidents',
    [
      'incident.created',
      'incident.alarm_linked',
      'incident.acknowledged',
      'incident.investigating',
      'incident.assigned',
      'incident.commented',
      'incident.corrective_action',
      'incident.resolved',
      'incident.closed',
    ],
  ],
  [
    'escalation',
    [
      'escalation_policy.created',
      'escalation_policy_version.requested',
      'escalation_policy_version.approved',
    ],
  ],
  ['maintenance', ['maintenance_record.created']],
  ['reports', ['report.generated', 'report.exported']],
];

export function groupedAuditActions(): readonly [AuditActionGroup, readonly AuditAction[]][] {
  return auditActionGroups;
}

const auditActionTranslationKeys: Readonly<Record<AuditAction, TranslationKey>> = {
  'user_role_grant.created': 'auditActionUserRoleGrantCreated',
  'user_role_grant.revoked': 'auditActionUserRoleGrantRevoked',
  'user_role_grant.cancelled': 'auditActionUserRoleGrantCancelled',
  'observation.corrected': 'auditActionObservationCorrected',
  'observation.rejected': 'auditActionObservationRejected',
  'observation.estimated': 'auditActionObservationEstimated',
  'observation.automatically_validated': 'auditActionObservationAutomaticallyValidated',
  'validation_profile.created': 'auditActionValidationProfileCreated',
  'validation_profile_version.created': 'auditActionValidationProfileVersionCreated',
  'validation_profile_version.approved': 'auditActionValidationProfileVersionApproved',
  'allocation_plan.created': 'auditActionAllocationPlanCreated',
  'allocation_plan_version.created': 'auditActionAllocationPlanVersionCreated',
  'allocation_plan_version.requested': 'auditActionAllocationPlanVersionRequested',
  'allocation_plan_version.approved': 'auditActionAllocationPlanVersionApproved',
  'allocation_plan_version.superseded': 'auditActionAllocationPlanVersionSuperseded',
  'allocation_plan_entry.created': 'auditActionAllocationPlanEntryCreated',
  'rating_curve.created': 'auditActionRatingCurveCreated',
  'rating_curve_version.approved': 'auditActionRatingCurveVersionApproved',
  'integration_coverage_policy.created': 'auditActionIntegrationCoveragePolicyCreated',
  'integration_coverage_policy_version.approved':
    'auditActionIntegrationCoveragePolicyVersionApproved',
  'allocation_plan_entry_measurement_binding.created':
    'auditActionAllocationPlanEntryMeasurementBindingCreated',
  'section_tolerance_policy.created': 'auditActionSectionTolerancePolicyCreated',
  'section_tolerance_policy_version.requested': 'auditActionSectionTolerancePolicyVersionRequested',
  'section_tolerance_policy_version.approved': 'auditActionSectionTolerancePolicyVersionApproved',
  'water_balance_model.created': 'auditActionWaterBalanceModelCreated',
  'water_balance_version.requested': 'auditActionWaterBalanceVersionRequested',
  'water_balance_version.approved': 'auditActionWaterBalanceVersionApproved',
  'alarm_rule.created': 'auditActionAlarmRuleCreated',
  'alarm_rule_version.requested': 'auditActionAlarmRuleVersionRequested',
  'alarm_rule_version.approved': 'auditActionAlarmRuleVersionApproved',
  'alarm_catalog.created': 'auditActionAlarmCatalogCreated',
  'alarm_catalog_policy.requested': 'auditActionAlarmCatalogPolicyRequested',
  'alarm_catalog_policy.approved': 'auditActionAlarmCatalogPolicyApproved',
  'alarm.created': 'auditActionAlarmCreated',
  'alarm.cleared': 'auditActionAlarmCleared',
  'escalation_policy.created': 'auditActionEscalationPolicyCreated',
  'escalation_policy_version.requested': 'auditActionEscalationPolicyVersionRequested',
  'escalation_policy_version.approved': 'auditActionEscalationPolicyVersionApproved',
  'incident.created': 'auditActionIncidentCreated',
  'incident.alarm_linked': 'auditActionIncidentAlarmLinked',
  'incident.acknowledged': 'auditActionIncidentAcknowledged',
  'incident.investigating': 'auditActionIncidentInvestigating',
  'incident.assigned': 'auditActionIncidentAssigned',
  'incident.commented': 'auditActionIncidentCommented',
  'incident.corrective_action': 'auditActionIncidentCorrectiveAction',
  'incident.resolved': 'auditActionIncidentResolved',
  'incident.closed': 'auditActionIncidentClosed',
  'maintenance_record.created': 'auditActionMaintenanceRecordCreated',
  'water_balance_component.created': 'auditActionWaterBalanceComponentCreated',
  'water_balance_assumption.created': 'auditActionWaterBalanceAssumptionCreated',
  'report.generated': 'auditActionReportGenerated',
  'report.exported': 'auditActionReportExported',
};

export function auditActionTranslationKey(action: AuditAction): TranslationKey {
  return auditActionTranslationKeys[action];
}

export function auditActionGroupTranslationKey(group: AuditActionGroup): TranslationKey {
  const keys: Record<AuditActionGroup, TranslationKey> = {
    identity: 'auditActionGroupIdentity',
    observations: 'auditActionGroupObservations',
    validation: 'auditActionGroupValidation',
    allocations: 'auditActionGroupAllocations',
    quantityModels: 'auditActionGroupQuantityModels',
    tolerances: 'auditActionGroupTolerances',
    waterBalance: 'auditActionGroupWaterBalance',
    alarms: 'auditActionGroupAlarms',
    incidents: 'auditActionGroupIncidents',
    escalation: 'auditActionGroupEscalation',
    maintenance: 'auditActionGroupMaintenance',
    reports: 'auditActionGroupReports',
  };
  return keys[group];
}

/** Identifiers stay inspectable without turning dense tables into UUID walls. */
export function shortIdentifier(value: string | null | undefined): string {
  return value ? value.slice(0, 8) : '—';
}

export interface AuditFilters {
  actorUserId: string;
  action: AuditAction | '';
  resource: AuditResource | '';
  resourceId: string;
  requestId: string;
  occurredFrom: string;
  occurredUntil: string;
}

export const defaultAuditFilters: AuditFilters = {
  actorUserId: '',
  action: '',
  resource: '',
  resourceId: '',
  requestId: '',
  occurredFrom: '',
  occurredUntil: '',
};

export function auditEventIdFromHash(hash: string): string | null {
  const [area, raw] = hash.replace(/^#/, '').split('?', 2);
  if (area !== 'audit') return null;
  const eventId = new URLSearchParams(raw ?? '').get('eventId');
  return eventId && uuid.test(eventId) ? eventId : null;
}

export function auditHash(eventId: string | null): string {
  return eventId && uuid.test(eventId) ? `#audit?eventId=${encodeURIComponent(eventId)}` : '#audit';
}

function utcValue(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function auditEventsPath(filters: AuditFilters, cursor: string | null = null): string {
  const query = new URLSearchParams({ limit: '25' });
  const values: Partial<ListAuditEventsQuery> = {
    actorUserId: filters.actorUserId || undefined,
    action: filters.action || undefined,
    resource: filters.resource || undefined,
    resourceId: filters.resourceId || undefined,
    requestId: filters.requestId || undefined,
    occurredFrom: utcValue(filters.occurredFrom),
    occurredUntil: utcValue(filters.occurredUntil),
    cursor: cursor ?? undefined,
  };
  for (const [key, value] of Object.entries(values)) if (value) query.set(key, String(value));
  return `/api/v1/audit/events?${query.toString()}`;
}

export function auditEventPath(eventId: string, territoryId: string | null): string {
  const query = territoryId ? `?territoryId=${encodeURIComponent(territoryId)}` : '';
  return `/api/v1/audit/events/${encodeURIComponent(eventId)}${query}`;
}

export function auditTimestamp(value: string): string {
  return value.replace('T', ' ').replace('Z', ' UTC');
}
