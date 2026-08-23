import { z } from 'zod';
import {
  decimalStringSchema,
  measurementKindSchema,
  observationQualityStateSchema,
  observationResponseSchema,
} from '../observations/observations.js';

const uuidSchema = z.uuid();
const utcTimestampSchema = z
  .string()
  .datetime({ offset: true })
  .refine(
    (value) => (value.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/i)?.[1]?.length ?? 0) <= 6,
    'timestamps support at most microsecond precision',
  );
function utcMicroseconds(value: string): bigint {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/i.exec(
    value,
  );
  if (!match) return 0n;
  const offsetMinutes =
    match[3] === 'Z'
      ? 0
      : (Number(match[3]!.slice(1, 3)) * 60 + Number(match[3]!.slice(4, 6))) *
        (match[3]!.startsWith('+') ? 1 : -1);
  return (
    BigInt(Date.parse(`${match[1]}Z`) - offsetMinutes * 60_000) * 1000n +
    BigInt((match[2] ?? '').padEnd(6, '0'))
  );
}
function decimalGreaterThan(left: string, right: string): boolean {
  const parse = (value: string) => {
    const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value)!;
    return {
      coefficient: (match[1] === '-' ? -1n : 1n) * BigInt(`${match[2]}${match[3] ?? ''}`),
      scale: (match[3] ?? '').length,
    };
  };
  const a = parse(left);
  const b = parse(right);
  const scale = Math.max(a.scale, b.scale);
  return (
    a.coefficient * 10n ** BigInt(scale - a.scale) > b.coefficient * 10n ** BigInt(scale - b.scale)
  );
}
export const validationRulesSchema = z
  .object({
    staleAfterSeconds: z.number().int().min(0).max(31_536_000).optional(),
    lateAfterSeconds: z.number().int().min(0).max(31_536_000).optional(),
    maximumRatePerSecond: decimalStringSchema.refine((value) => Number(value) >= 0).optional(),
    frozenAfterCount: z.number().int().min(2).max(1000).optional(),
    acceptReportedCounterTransitions: z.literal(true).optional(),
    minimumValue: decimalStringSchema.optional(),
    maximumValue: decimalStringSchema.optional(),
    allowBootstrapWithoutPrior: z.literal(true).optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    'an approved validation profile requires at least one explicit rule',
  )
  .superRefine((value, context) => {
    if (
      value.minimumValue !== undefined &&
      value.maximumValue !== undefined &&
      decimalGreaterThan(value.minimumValue, value.maximumValue)
    )
      context.addIssue({
        code: 'custom',
        path: ['maximumValue'],
        message: 'must be at least minimumValue',
      });
    if (
      value.allowBootstrapWithoutPrior === true &&
      value.minimumValue === undefined &&
      value.maximumValue === undefined
    )
      context.addIssue({
        code: 'custom',
        path: ['allowBootstrapWithoutPrior'],
        message: 'requires a minimumValue or maximumValue',
      });
  });
export type ValidationRules = z.infer<typeof validationRulesSchema>;

const profileScopeSchema = z.object({
  organizationId: uuidSchema,
  territoryId: uuidSchema,
  sensorId: uuidSchema,
  measurementKind: measurementKindSchema,
  dataClassification: z.enum(['synthetic', 'official']),
});
export const createValidationProfileRequestSchema = profileScopeSchema
  .extend({
    name: z.string().trim().min(1).max(160),
    effectiveFrom: utcTimestampSchema,
    effectiveUntil: utcTimestampSchema.nullable().optional(),
    rules: validationRulesSchema,
    reason: z.string().trim().min(1).max(1000),
  })
  .superRefine((value, ctx) => {
    if (
      value.effectiveUntil &&
      utcMicroseconds(value.effectiveUntil) <= utcMicroseconds(value.effectiveFrom)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['effectiveUntil'],
        message: 'must be after effectiveFrom',
      });
  });
export type CreateValidationProfileRequest = z.infer<typeof createValidationProfileRequestSchema>;
export const createValidationProfileVersionRequestSchema = z
  .object({
    territoryId: uuidSchema,
    effectiveFrom: utcTimestampSchema,
    effectiveUntil: utcTimestampSchema.nullable().optional(),
    rules: validationRulesSchema,
    reason: z.string().trim().min(1).max(1000),
  })
  .superRefine((value, ctx) => {
    if (
      value.effectiveUntil &&
      utcMicroseconds(value.effectiveUntil) <= utcMicroseconds(value.effectiveFrom)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['effectiveUntil'],
        message: 'must be after effectiveFrom',
      });
  });
export type CreateValidationProfileVersionRequest = z.infer<
  typeof createValidationProfileVersionRequestSchema
>;
export const approveValidationProfileVersionRequestSchema = z.object({
  territoryId: uuidSchema,
  reason: z.string().trim().min(1).max(1000),
});
export type ApproveValidationProfileVersionRequest = z.infer<
  typeof approveValidationProfileVersionRequestSchema
>;

export const validationProfileVersionSchema = profileScopeSchema.extend({
  id: uuidSchema,
  profileId: uuidSchema,
  version: z.number().int().positive(),
  name: z.string().min(1).max(160),
  status: z.enum(['draft', 'approved']),
  effectiveFrom: utcTimestampSchema,
  effectiveUntil: utcTimestampSchema.nullable(),
  rules: validationRulesSchema,
  draftedByUserId: uuidSchema,
  draftedAt: utcTimestampSchema,
  approvedByUserId: uuidSchema.nullable(),
  approvedAt: utcTimestampSchema.nullable(),
  approvalReason: z.string().nullable(),
  syntheticNonAuthoritative: z.boolean(),
});
export type ValidationProfileVersion = z.infer<typeof validationProfileVersionSchema>;
export const validationProfileVersionResponseSchema = z.object({
  profileVersion: validationProfileVersionSchema,
});

export const validateObservationRequestSchema = z.object({
  territoryId: uuidSchema,
  /** Algorithm identity is explicit so revalidation never silently changes history. */
  algorithmVersion: z.literal('v1').default('v1'),
});
export type ValidateObservationRequest = z.infer<typeof validateObservationRequestSchema>;
export const automaticValidationResponseSchema = z.object({
  outcome: z.enum(['applied', 'deferred']),
  deferReason: z
    .enum(['no_approved_profile', 'current_revision_not_raw', 'insufficient_evidence'])
    .nullable(),
  profileVersionId: uuidSchema.nullable(),
  profileVersion: z.number().int().positive().nullable(),
  evidence: z.array(z.string()),
  observation: observationResponseSchema.shape.observation.nullable(),
  /** no_data/incomplete/complete require a separately configured interval policy. */
  coverageState: z.enum(['unconfigured', 'no_data', 'incomplete', 'complete']),
  qualityState: observationQualityStateSchema.nullable(),
});
export type AutomaticValidationResponse = z.infer<typeof automaticValidationResponseSchema>;
