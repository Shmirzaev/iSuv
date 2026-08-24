import { z } from 'zod';
import { quantityDerivationTimestampSchema } from '../quantity-derivation/quantity-derivation.js';

const uuid = z.uuid();
const text = z.string().trim().min(1).max(256);
const reason = z.string().trim().min(1).max(1000);
const signedDecimal = z
  .string()
  .regex(/^-?(?:0|[1-9]\d{0,17})(?:\.\d{1,12})?$/, 'must be an exact decimal');
const nonnegativeDecimal = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,17})(?:\.\d{1,12})?$/, 'must be a nonnegative exact decimal');
const MAX_DURATION_MICROSECONDS = 31_536_000_000_000n; // 365 days: bounds replay work and bigint inputs.
const durationMicroseconds = z
  .string()
  .regex(/^\d+$/, 'must be a positive integer number of microseconds')
  .superRefine((value, issue) => {
    const duration = BigInt(value);
    if (duration <= 0n || duration > MAX_DURATION_MICROSECONDS)
      issue.addIssue({
        code: 'custom',
        message: `must be between 1 and ${MAX_DURATION_MICROSECONDS} microseconds`,
      });
  });

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

function decimalComparison(a: string, b: string): number {
  const parse = (value: string) => {
    const negative = value.startsWith('-');
    const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
    const denominator = 10n ** BigInt(fraction.length);
    return { numerator: (negative ? -1n : 1n) * BigInt(`${whole}${fraction}`), denominator };
  };
  const left = parse(a);
  const right = parse(b);
  const compared = left.numerator * right.denominator - right.numerator * left.denominator;
  return compared < 0n ? -1 : compared > 0n ? 1 : 0;
}

const observationThresholdConditionSchema = z
  .object({
    kind: z.literal('observation_threshold'),
    sensorId: uuid,
    quantity: z.enum(['stage', 'discharge']),
    unit: z.enum(['m', 'm3/s']),
    direction: z.enum(['high', 'low']),
    enter: signedDecimal,
    clear: signedDecimal,
    enterPersistenceMicroseconds: durationMicroseconds,
    clearPersistenceMicroseconds: durationMicroseconds,
    maxGapMicroseconds: durationMicroseconds,
    uncertaintyBound: nonnegativeDecimal,
    rateGate: z
      .object({
        direction: z.enum(['rise', 'fall']),
        unit: z.enum(['m/s', 'm3/s2']),
        enter: nonnegativeDecimal,
        clear: nonnegativeDecimal,
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((value, issue) => {
    const enter = decimalComparison(value.enter, value.clear);
    if ((value.direction === 'high' && enter <= 0) || (value.direction === 'low' && enter >= 0))
      issue.addIssue({
        code: 'custom',
        path: ['clear'],
        message: 'high rules require clear < enter; low rules require clear > enter',
      });
    if (
      (value.quantity === 'stage' && value.unit !== 'm') ||
      (value.quantity === 'discharge' && value.unit !== 'm3/s')
    )
      issue.addIssue({
        code: 'custom',
        path: ['unit'],
        message: 'unit must match quantity',
      });
    if (
      value.rateGate &&
      ((value.quantity === 'stage' && value.rateGate.unit !== 'm/s') ||
        (value.quantity === 'discharge' && value.rateGate.unit !== 'm3/s2'))
    )
      issue.addIssue({
        code: 'custom',
        path: ['rateGate', 'unit'],
        message: 'rate unit must match quantity',
      });
    if (value.rateGate && decimalComparison(value.rateGate.enter, value.rateGate.clear) <= 0)
      issue.addIssue({
        code: 'custom',
        path: ['rateGate', 'clear'],
        message: 'rate clear threshold must be strictly below enter threshold',
      });
  });

const allocationDeviationConditionSchema = z
  .object({
    kind: z.literal('allocation_deviation'),
    planId: uuid,
    direction: z.enum(['over', 'under']),
    enterPersistenceMicroseconds: durationMicroseconds,
    clearPersistenceMicroseconds: durationMicroseconds,
    maxGapMicroseconds: durationMicroseconds,
  })
  .strict();

/** Conditions are policy only; no severity, incident workflow, or physical-control field is accepted. */
export const alarmConditionSchema = z.discriminatedUnion('kind', [
  observationThresholdConditionSchema,
  allocationDeviationConditionSchema,
]);
export type AlarmCondition = z.infer<typeof alarmConditionSchema>;

export const createAlarmRuleRequestSchema = z
  .object({
    territoryId: uuid,
    subjectKind: z.enum(['observation_sensor', 'allocation_plan']),
    subjectId: uuid,
    provenance: text,
    reason,
  })
  .strict();
export type CreateAlarmRuleRequest = z.infer<typeof createAlarmRuleRequestSchema>;

export const requestAlarmRuleVersionRequestSchema = z
  .object({
    effectiveFrom: quantityDerivationTimestampSchema,
    effectiveUntil: quantityDerivationTimestampSchema,
    condition: alarmConditionSchema,
    provenance: text,
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
  });
export type RequestAlarmRuleVersionRequest = z.infer<typeof requestAlarmRuleVersionRequestSchema>;

export const approveAlarmRuleVersionRequestSchema = z.object({ reason }).strict();
export type ApproveAlarmRuleVersionRequest = z.infer<typeof approveAlarmRuleVersionRequestSchema>;

const exactRationalSchema = z
  .object({ numerator: z.string().regex(/^-?\d+$/), denominator: z.string().regex(/^\d+$/) })
  .strict()
  .superRefine((value, issue) => {
    if (BigInt(value.denominator) <= 0n)
      issue.addIssue({ code: 'custom', path: ['denominator'], message: 'must be positive' });
  });
const eventFactsSchema = z
  .object({
    eventStart: quantityDerivationTimestampSchema,
    eventEnd: quantityDerivationTimestampSchema,
    observedAt: quantityDerivationTimestampSchema,
    knownAt: quantityDerivationTimestampSchema,
    sourceIds: z.array(uuid).min(1),
    revisionIds: z.array(uuid).min(1),
    policyIds: z.array(uuid).min(1),
    trusted: z.boolean(),
    complete: z.boolean(),
    estimated: z.boolean(),
    provenance: text,
    dataClassification: z.literal('synthetic'),
    officialComplianceEligible: z.literal(false),
  })
  .strict()
  .superRefine((value, issue) => {
    if (timestampMicros(value.eventEnd) < timestampMicros(value.eventStart))
      issue.addIssue({
        code: 'custom',
        path: ['eventEnd'],
        message: 'must not precede eventStart',
      });
    const observed = timestampMicros(value.observedAt);
    if (observed < timestampMicros(value.eventStart) || observed > timestampMicros(value.eventEnd))
      issue.addIssue({
        code: 'custom',
        path: ['observedAt'],
        message: 'must fall within event interval',
      });
  });

export const observationConditionFactSchema = eventFactsSchema
  .extend({
    kind: z.literal('observation'),
    sensorId: uuid,
    quantity: z.enum(['stage', 'discharge']),
    unit: z.enum(['m', 'm3/s']),
    value: exactRationalSchema.nullable(),
    uncertainty: exactRationalSchema.nullable(),
    ratePerSecond: exactRationalSchema.nullable(),
  })
  .strict();
export const allocationConditionFactSchema = eventFactsSchema
  .extend({
    kind: z.literal('allocation'),
    planId: uuid,
    outcome: z.enum(['computed', 'unassessable']),
    condition: z.enum(['under', 'within', 'over', 'unassessable']),
    value: exactRationalSchema.nullable(),
    uncertainty: exactRationalSchema.nullable(),
  })
  .strict()
  .superRefine((value, issue) => {
    if (
      (value.outcome === 'computed' && value.condition === 'unassessable') ||
      (value.outcome === 'unassessable' && value.condition !== 'unassessable')
    )
      issue.addIssue({
        code: 'custom',
        path: ['condition'],
        message: 'must match allocation outcome',
      });
  });
export const alarmConditionFactSchema = z.discriminatedUnion('kind', [
  observationConditionFactSchema,
  allocationConditionFactSchema,
]);
export type AlarmConditionFact = z.infer<typeof alarmConditionFactSchema>;

export const alarmRuleEvaluationQuerySchema = z
  .object({
    effectiveAt: quantityDerivationTimestampSchema,
    knownAt: quantityDerivationTimestampSchema.optional(),
  })
  .strict();
export type AlarmRuleEvaluationQuery = z.infer<typeof alarmRuleEvaluationQuerySchema>;

export const alarmRuleEvaluationSchema = z
  .object({
    ruleId: uuid,
    versionId: uuid.nullable(),
    effectiveAt: quantityDerivationTimestampSchema,
    knownAt: quantityDerivationTimestampSchema,
    state: z.enum(['inactive', 'pending_activation', 'active', 'pending_clear', 'deferred']),
    reason: z
      .enum([
        'unconfigured_rule',
        'missing_fact',
        'invalid_fact',
        'untrusted_fact',
        'incomplete_fact',
        'estimated_fact',
        'unknown_uncertainty',
        'uncertainty_exceeds_bound',
        'missing_provenance',
        'wrong_subject',
        'wrong_quantity_or_unit',
        'duplicate_or_nonmonotonic',
        'gap_exceeded',
        'rate_gate_not_met',
        'allocation_unassessable',
      ])
      .nullable(),
    qualifyingStart: quantityDerivationTimestampSchema.nullable(),
    qualifyingEnd: quantityDerivationTimestampSchema.nullable(),
    qualifyingDurationMicroseconds: z.string().regex(/^\d+$/),
    qualifyingFactCount: z.number().int().nonnegative(),
    evidence: z.array(alarmConditionFactSchema),
    dataClassification: z.literal('synthetic'),
    officialComplianceEligible: z.literal(false),
    alarmEligible: z.literal(false),
  })
  .strict();
export type AlarmRuleEvaluation = z.infer<typeof alarmRuleEvaluationSchema>;
export const alarmRuleEvaluationResponseSchema = z
  .object({ evaluation: alarmRuleEvaluationSchema })
  .strict();
