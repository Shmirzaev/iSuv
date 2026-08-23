import { z } from 'zod';

const uuid = z.uuid();
function leap(year: bigint): boolean {
  return year % 4n === 0n && (year % 100n !== 0n || year % 400n === 0n);
}
function daysBeforeYear(year: bigint): bigint {
  const prior = year - 1n;
  return 365n * prior + prior / 4n - prior / 100n + prior / 400n;
}
/** Exact ISO timestamp ordering without rounding timestamp microseconds through Date. */
function timestampMicros(value: string): bigint {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/i.exec(
      value,
    );
  if (!match) return 0n;
  const [, year, month, day, hour, minute, second, fraction = '', zone] = match;
  const monthLengths = [31n, 28n, 31n, 30n, 31n, 30n, 31n, 31n, 30n, 31n, 30n, 31n];
  let days = daysBeforeYear(BigInt(year!)) - daysBeforeYear(1970n) + BigInt(day!) - 1n;
  for (let index = 1n; index < BigInt(month!); index += 1n)
    days += monthLengths[Number(index - 1n)]! + (index === 2n && leap(BigInt(year!)) ? 1n : 0n);
  const normalizedZone = zone!;
  const offset =
    normalizedZone === 'Z'
      ? 0n
      : (BigInt(normalizedZone.slice(1, 3)) * 60n + BigInt(normalizedZone.slice(4, 6))) *
        (normalizedZone.startsWith('+') ? 1n : -1n);
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
export const quantityDerivationTimestampSchema = z
  .string()
  .datetime({ offset: true })
  .refine(
    (value) => (value.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/i)?.[1]?.length ?? 0) <= 6,
    'timestamps support at most microsecond precision',
  );
export const derivationDecimalSchema = z
  .string()
  .regex(
    /^(?:0|[1-9]\d{0,17})(?:\.\d{1,12})?$/,
    'must be a finite nonnegative decimal with at most 12 fractional digits',
  );
export const quantityDerivationMethodSchema = z.enum([
  'direct_discharge',
  'stage_rating_curve',
  'accumulated_volume_delta',
]);
export type QuantityDerivationMethod = z.infer<typeof quantityDerivationMethodSchema>;

export const ratingCurveKnotSchema = z.object({
  stageM: derivationDecimalSchema,
  dischargeM3s: derivationDecimalSchema,
});
export const ratingCurveVersionSchema = z.object({
  id: uuid,
  curveId: uuid,
  version: z.number().int().positive(),
  organizationId: uuid,
  territoryId: uuid,
  stationId: uuid,
  stageSensorId: uuid,
  deviceInstallationId: uuid,
  effectiveFrom: quantityDerivationTimestampSchema,
  effectiveUntil: quantityDerivationTimestampSchema.nullable(),
  knownAt: quantityDerivationTimestampSchema,
  knots: z.array(ratingCurveKnotSchema).min(2),
  algorithm: z.literal('synthetic_piecewise_linear_v1'),
  hydraulicAssumptions: z.literal('stationary_single_valued_no_hysteresis'),
  provenance: z.string().min(1).max(256),
  dataClassification: z.literal('synthetic'),
  officialComplianceEligible: z.literal(false),
});
export type RatingCurveVersion = z.infer<typeof ratingCurveVersionSchema>;

export const integrationCoveragePolicyVersionSchema = z.object({
  id: uuid,
  policyId: uuid,
  version: z.number().int().positive(),
  organizationId: uuid,
  territoryId: uuid,
  stationId: uuid,
  sensorId: uuid,
  deviceInstallationId: uuid,
  method: quantityDerivationMethodSchema,
  effectiveFrom: quantityDerivationTimestampSchema,
  effectiveUntil: quantityDerivationTimestampSchema.nullable(),
  knownAt: quantityDerivationTimestampSchema,
  maxGapMicroseconds: z.string().regex(/^\d+$/),
  provenance: z.string().min(1).max(256),
  dataClassification: z.literal('synthetic'),
  officialComplianceEligible: z.literal(false),
});
export type IntegrationCoveragePolicyVersion = z.infer<
  typeof integrationCoveragePolicyVersionSchema
>;

export const derivedIntervalSchema = z.object({
  start: quantityDerivationTimestampSchema,
  end: quantityDerivationTimestampSchema,
});
export const derivedSourceRefSchema = z.object({
  lineageId: uuid,
  revisionId: uuid,
  observedAt: quantityDerivationTimestampSchema,
  sensorId: uuid,
  deviceInstallationId: uuid,
  measurementMethod: z.string().min(1).max(256).nullable(),
  totalizerTransition: z
    .enum(['normal', 'reset_reported', 'rollover_reported', 'unknown'])
    .nullable(),
  workflowState: z.enum([
    'raw',
    'automatically_validated',
    'expert_validated',
    'corrected',
    'estimated',
    'rejected',
  ]),
  qualityState: z.enum(['unknown', 'valid', 'suspect', 'invalid', 'estimated']),
});
export const exactRationalSchema = z.object({
  numerator: z.string().regex(/^-?\d+$/),
  denominator: z.string().regex(/^\d+$/),
  unit: z.literal('m3'),
});
const common = {
  measurementKind: z.literal('interval_volume'),
  unit: z.literal('m3'),
  requestedInterval: derivedIntervalSchema,
  coveredInterval: derivedIntervalSchema.nullable(),
  coverage: z.enum(['unconfigured', 'no_data', 'incomplete', 'complete']),
  knownAt: quantityDerivationTimestampSchema,
  method: quantityDerivationMethodSchema,
  policyVersionId: uuid.nullable(),
  curveVersionId: uuid.nullable(),
  sourceRefs: z.array(derivedSourceRefSchema),
  provenance: z.string().min(1).max(256),
  dataClassification: z.literal('synthetic'),
  officialComplianceEligible: z.literal(false),
  qualityState: z.enum(['valid', 'estimated', 'unreliable', 'no_data']),
  uncertainty: z
    .object({ method: z.string().min(1), value: derivationDecimalSchema.nullable() })
    .nullable(),
};
export const derivedVolumeResultSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('computed'),
    ...common,
    deferReason: z.null(),
    volume: exactRationalSchema,
  }),
  z.object({
    outcome: z.literal('deferred'),
    ...common,
    deferReason: z.enum([
      'no_approved_coverage_policy',
      'no_approved_rating_curve',
      'policy_or_curve_not_effective_for_interval',
      'missing_exact_endpoint',
      'observation_gap_exceeds_policy',
      'observations_not_strictly_ordered',
      'mixed_sensor_installation_or_method',
      'unusable_observation',
      'stage_outside_rating_curve',
      'negative_discharge_not_configured',
      'counter_policy_not_approved',
      'counter_reset_or_rollover',
      'counter_decrease',
      'counter_missing_endpoint',
    ]),
    volume: z.null(),
  }),
]);
export type DerivedVolumeResult = z.infer<typeof derivedVolumeResultSchema>;

export const deriveVolumeQuerySchema = z
  .object({
    sensorId: uuid,
    method: quantityDerivationMethodSchema,
    intervalStart: quantityDerivationTimestampSchema,
    intervalEnd: quantityDerivationTimestampSchema,
    knownAt: quantityDerivationTimestampSchema.optional(),
  })
  .superRefine((value, context) => {
    if (timestampMicros(value.intervalEnd) <= timestampMicros(value.intervalStart))
      context.addIssue({
        code: 'custom',
        path: ['intervalEnd'],
        message: 'must be after intervalStart',
      });
  });
export const derivedVolumeResponseSchema = z.object({ result: derivedVolumeResultSchema });
export const ratingCurveLookupQuerySchema = z.object({
  effectiveAt: quantityDerivationTimestampSchema,
  knownAt: quantityDerivationTimestampSchema.optional(),
});
export const ratingCurveLookupResponseSchema = z.object({
  ratingCurveVersion: ratingCurveVersionSchema,
});
