import { z } from 'zod';
import { quantityDerivationTimestampSchema } from '../quantity-derivation/quantity-derivation.js';

const uuid = z.uuid();
const label = z.string().trim().min(1).max(256);
const reason = z.string().trim().min(1).max(1000);

/**
 * The catalog names every canonical operator-facing event family. Allocation
 * directions remain distinct because governed plans can be over or under.
 */
export const alarmEventTypeSchema = z.enum([
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
export type AlarmEventType = z.infer<typeof alarmEventTypeSchema>;

/** Hydrological status is not an urgency or response-priority classification. */
export const waterConditionSchema = z.enum([
  'over_allocation',
  'under_allocation',
  'high_stage',
  'dry_canal',
  'sudden_flow_change',
  'unexplained_balance',
  'not_assessed',
  'unassessable',
]);
export type WaterCondition = z.infer<typeof waterConditionSchema>;

/** Device/system condition is intentionally parallel to (and independent from) water condition. */
export const systemDeviceConditionSchema = z.enum([
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
export type SystemDeviceCondition = z.infer<typeof systemDeviceConditionSchema>;

export const alarmSeveritySchema = z.enum(['information', 'advisory', 'warning', 'critical']);
export type AlarmSeverity = z.infer<typeof alarmSeveritySchema>;

/**
 * `p4_001_rule_signal` means the catalog binding may be considered against the
 * narrow compatibility map in the domain package.  Every unavailable bridge is
 * explicitly unconfigured; it is never silently treated as healthy.
 */
export const alarmActivationSupportSchema = z.enum(['p4_001_rule_signal', 'unconfigured']);
export type AlarmActivationSupport = z.infer<typeof alarmActivationSupportSchema>;

export const alarmCatalogStatusSchema = z.enum(['draft', 'requested', 'approved', 'superseded']);
export type AlarmCatalogStatus = z.infer<typeof alarmCatalogStatusSchema>;

export const createAlarmCatalogRequestSchema = z
  .object({
    territoryId: uuid,
    eventType: alarmEventTypeSchema,
    title: label,
    provenance: label,
    reason,
  })
  .strict();
export type CreateAlarmCatalogRequest = z.infer<typeof createAlarmCatalogRequestSchema>;

function timestampMicros(value: string): bigint {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/i.exec(
      value,
    );
  if (!match) return 0n;
  const [, year, month, day, hour, minute, second, fraction = '', zone] = match;
  const leap = (candidate: bigint) =>
    candidate % 4n === 0n && (candidate % 100n !== 0n || candidate % 400n === 0n);
  const beforeYear = (candidate: bigint) => {
    const prior = candidate - 1n;
    return 365n * prior + prior / 4n - prior / 100n + prior / 400n;
  };
  const monthLengths = [31n, 28n, 31n, 30n, 31n, 30n, 31n, 31n, 30n, 31n, 30n, 31n];
  let days = beforeYear(BigInt(year!)) - beforeYear(1970n) + BigInt(day!) - 1n;
  for (let index = 1n; index < BigInt(month!); index += 1n)
    days += monthLengths[Number(index - 1n)]! + (index === 2n && leap(BigInt(year!)) ? 1n : 0n);
  const offset =
    zone === 'Z'
      ? 0n
      : (BigInt(zone!.slice(1, 3)) * 60n + BigInt(zone!.slice(4, 6))) *
        (zone!.startsWith('+') ? 1n : -1n);
  return (
    (days * 86_400n +
      BigInt(hour!) * 3_600n +
      BigInt(minute!) * 60n +
      BigInt(second!) -
      offset * 60n) *
      1_000_000n +
    BigInt(fraction.padEnd(6, '0'))
  );
}

export const requestAlarmCatalogVersionRequestSchema = z
  .object({
    effectiveFrom: quantityDerivationTimestampSchema,
    effectiveUntil: quantityDerivationTimestampSchema,
    ruleId: uuid.nullable(),
    activationSupport: alarmActivationSupportSchema,
    waterCondition: waterConditionSchema,
    systemDeviceCondition: systemDeviceConditionSchema,
    severity: alarmSeveritySchema,
    provenance: label,
    reason,
  })
  .strict()
  .superRefine((value, issue) => {
    if (timestampMicros(value.effectiveUntil) <= timestampMicros(value.effectiveFrom))
      issue.addIssue({
        code: 'custom',
        path: ['effectiveUntil'],
        message: 'must be after effectiveFrom',
      });
    if (
      (value.activationSupport === 'p4_001_rule_signal' && !value.ruleId) ||
      (value.activationSupport === 'unconfigured' && value.ruleId)
    )
      issue.addIssue({
        code: 'custom',
        path: ['ruleId'],
        message: 'rule binding must match activation support',
      });
  });
export type RequestAlarmCatalogVersionRequest = z.infer<
  typeof requestAlarmCatalogVersionRequestSchema
>;

export const approveAlarmCatalogVersionRequestSchema = z.object({ reason }).strict();
export type ApproveAlarmCatalogVersionRequest = z.infer<
  typeof approveAlarmCatalogVersionRequestSchema
>;

export const alarmCatalogVersionSchema = z
  .object({
    id: uuid,
    catalogId: uuid,
    version: z.number().int().positive(),
    organizationId: uuid,
    territoryId: uuid,
    eventType: alarmEventTypeSchema,
    title: label,
    ruleId: uuid.nullable(),
    activationSupport: alarmActivationSupportSchema,
    waterCondition: waterConditionSchema,
    systemDeviceCondition: systemDeviceConditionSchema,
    severity: alarmSeveritySchema,
    status: alarmCatalogStatusSchema,
    effectiveFrom: quantityDerivationTimestampSchema,
    effectiveUntil: quantityDerivationTimestampSchema.nullable(),
    knownAt: quantityDerivationTimestampSchema,
    provenance: label,
    dataClassification: z.literal('synthetic'),
    officialComplianceEligible: z.literal(false),
    authoredByUserId: uuid,
    authoredAt: quantityDerivationTimestampSchema,
    requestedByUserId: uuid.nullable(),
    requestedAt: quantityDerivationTimestampSchema.nullable(),
    requestReason: z.string().nullable(),
    approvedByUserId: uuid.nullable(),
    approvedAt: quantityDerivationTimestampSchema.nullable(),
    approvalReason: z.string().nullable(),
  })
  .strict();
export type AlarmCatalogVersion = z.infer<typeof alarmCatalogVersionSchema>;

export const alarmCatalogVersionResponseSchema = z
  .object({ catalogVersion: alarmCatalogVersionSchema })
  .strict();
export const alarmCatalogReadQuerySchema = z
  .object({
    effectiveAt: quantityDerivationTimestampSchema,
    knownAt: quantityDerivationTimestampSchema.optional(),
  })
  .strict();
export type AlarmCatalogReadQuery = z.infer<typeof alarmCatalogReadQuerySchema>;
export const alarmCatalogReadResponseSchema = z
  .object({
    resolution: z.enum(['configured', 'unconfigured']),
    effectiveAt: quantityDerivationTimestampSchema,
    knownAt: quantityDerivationTimestampSchema,
    catalogVersion: alarmCatalogVersionSchema.nullable(),
    reason: z.enum(['no_approved_catalog_version', 'source_bridge_unconfigured']).nullable(),
  })
  .strict();

/** Deliberately small request: persistence resolves every source/evidence field itself. */
export const materializeAlarmRequestSchema = z
  .object({
    ruleId: uuid,
    effectiveAt: quantityDerivationTimestampSchema,
    knownAt: quantityDerivationTimestampSchema,
  })
  .strict();
export type MaterializeAlarmRequest = z.infer<typeof materializeAlarmRequestSchema>;

export const automaticAlarmStateSchema = z.enum(['active', 'cleared']);
export type AutomaticAlarmState = z.infer<typeof automaticAlarmStateSchema>;
export const alarmEpisodeSchema = z
  .object({
    id: uuid,
    organizationId: uuid,
    territoryId: uuid,
    eventType: alarmEventTypeSchema,
    waterCondition: waterConditionSchema,
    systemDeviceCondition: systemDeviceConditionSchema,
    severity: alarmSeveritySchema,
    automaticState: automaticAlarmStateSchema,
    catalogId: uuid,
    catalogVersionId: uuid,
    ruleId: uuid,
    ruleVersionId: uuid,
    activationSignalRunId: uuid,
    latestSignalRunId: uuid,
    activationEvidence: z.array(uuid).min(1),
    provenance: label,
    detectedAt: quantityDerivationTimestampSchema,
    effectiveAt: quantityDerivationTimestampSchema,
    knownAt: quantityDerivationTimestampSchema,
    clearedAt: quantityDerivationTimestampSchema.nullable(),
    clearSignalRunId: uuid.nullable(),
    dataClassification: z.literal('synthetic'),
    officialComplianceEligible: z.literal(false),
  })
  .strict();
export type AlarmEpisode = z.infer<typeof alarmEpisodeSchema>;

export const alarmMaterializationResultSchema = z.discriminatedUnion('outcome', [
  z
    .object({
      outcome: z.literal('created'),
      action: z.literal('activated'),
      alarm: alarmEpisodeSchema,
      reason: z.null(),
    })
    .strict(),
  z
    .object({
      outcome: z.literal('existing'),
      action: z.enum([
        'continued',
        'preserved_pending',
        'preserved_unassessable',
        'automatically_cleared',
      ]),
      alarm: alarmEpisodeSchema,
      reason: z.null(),
    })
    .strict(),
  z
    .object({
      outcome: z.literal('not_materialized'),
      action: z.null(),
      alarm: z.null(),
      reason: z.enum([
        'unconfigured_catalog',
        'unsupported_source',
        'incompatible_catalog_binding',
        'signal_deferred',
        'signal_pending_activation',
        'signal_pending_clear',
        'signal_inactive',
        'no_active_alarm_episode',
      ]),
    })
    .strict(),
]);
export type AlarmMaterializationResult = z.infer<typeof alarmMaterializationResultSchema>;
export const alarmMaterializationResponseSchema = z
  .object({ materialization: alarmMaterializationResultSchema })
  .strict();
