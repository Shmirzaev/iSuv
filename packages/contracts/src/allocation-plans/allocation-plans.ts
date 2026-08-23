import { z } from 'zod';
import { nonnegativeDecimalStringSchema } from '../observations/observations.js';

const uuidSchema = z.uuid();
export const allocationPlanTimestampSchema = z
  .string()
  .datetime({ offset: true })
  .refine(
    (value) => (value.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/i)?.[1]?.length ?? 0) <= 6,
    'timestamps support at most microsecond precision',
  );
function micros(value: string): bigint {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/i.exec(
    value,
  );
  if (!match) return 0n;
  const offset =
    match[3] === 'Z'
      ? 0
      : (Number(match[3]!.slice(1, 3)) * 60 + Number(match[3]!.slice(4, 6))) *
        (match[3]!.startsWith('+') ? 1 : -1);
  return (
    BigInt(Date.parse(`${match[1]}Z`) - offset * 60_000) * 1000n +
    BigInt((match[2] ?? '').padEnd(6, '0'))
  );
}
export const plannedDeliveryEntrySchema = z
  .object({
    intervalStart: allocationPlanTimestampSchema,
    intervalEnd: allocationPlanTimestampSchema,
    plannedVolume: nonnegativeDecimalStringSchema,
    unit: z.literal('m3'),
    targetSemantics: z
      .literal('whole_interval_target_no_proration')
      .default('whole_interval_target_no_proration'),
  })
  .superRefine((value, context) => {
    if (micros(value.intervalEnd) <= micros(value.intervalStart))
      context.addIssue({
        code: 'custom',
        path: ['intervalEnd'],
        message: 'must be after intervalStart',
      });
  });
export type PlannedDeliveryEntry = z.infer<typeof plannedDeliveryEntrySchema>;
const versionContentSchema = z
  .object({
    effectiveFrom: allocationPlanTimestampSchema,
    effectiveUntil: allocationPlanTimestampSchema.nullable().optional(),
    entries: z.array(plannedDeliveryEntrySchema).min(1).max(10_000),
    reason: z.string().trim().min(1).max(1000),
  })
  .superRefine((value, context) => {
    const until = value.effectiveUntil ? micros(value.effectiveUntil) : null;
    if (until !== null && until <= micros(value.effectiveFrom))
      context.addIssue({
        code: 'custom',
        path: ['effectiveUntil'],
        message: 'must be after effectiveFrom',
      });
    const sorted = [...value.entries].sort((a, b) =>
      micros(a.intervalStart) < micros(b.intervalStart)
        ? -1
        : micros(a.intervalStart) > micros(b.intervalStart)
          ? 1
          : 0,
    );
    for (let index = 0; index < sorted.length; index += 1) {
      const entry = sorted[index]!;
      if (
        micros(entry.intervalStart) < micros(value.effectiveFrom) ||
        (until !== null && micros(entry.intervalEnd) > until)
      )
        context.addIssue({
          code: 'custom',
          path: ['entries', index],
          message: 'entry must be within the version effective window',
        });
      if (index && micros(entry.intervalStart) < micros(sorted[index - 1]!.intervalEnd))
        context.addIssue({
          code: 'custom',
          path: ['entries', index],
          message: 'entry intervals must not overlap',
        });
    }
  });
export const createAllocationPlanRequestSchema = versionContentSchema.extend({
  waterSectionId: uuidSchema,
});
export type CreateAllocationPlanRequest = z.infer<typeof createAllocationPlanRequestSchema>;
export const appendAllocationPlanVersionRequestSchema = versionContentSchema;
export type AppendAllocationPlanVersionRequest = z.infer<
  typeof appendAllocationPlanVersionRequestSchema
>;
export const requestAllocationPlanVersionRequestSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});
export const approveAllocationPlanVersionRequestSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
  legalReference: z.string().trim().min(1).max(512),
});
export type ApproveAllocationPlanVersionRequest = z.infer<
  typeof approveAllocationPlanVersionRequestSchema
>;
export const allocationPlanStatusSchema = z.enum(['draft', 'requested', 'approved', 'superseded']);
export const allocationPlanVersionSchema = z.object({
  id: uuidSchema,
  planId: uuidSchema,
  version: z.number().int().positive(),
  organizationId: uuidSchema,
  territoryId: uuidSchema,
  waterSectionId: uuidSchema,
  dataClassification: z.literal('synthetic'),
  status: allocationPlanStatusSchema,
  effectiveFrom: allocationPlanTimestampSchema,
  declaredEffectiveUntil: allocationPlanTimestampSchema.nullable(),
  governedEffectiveUntil: allocationPlanTimestampSchema.nullable(),
  entries: z.array(plannedDeliveryEntrySchema),
  draftedByUserId: uuidSchema,
  draftedAt: allocationPlanTimestampSchema,
  requestedByUserId: uuidSchema.nullable(),
  requestedAt: allocationPlanTimestampSchema.nullable(),
  requestReason: z.string().nullable(),
  approvedByUserId: uuidSchema.nullable(),
  approvedAt: allocationPlanTimestampSchema.nullable(),
  approvalReason: z.string().nullable(),
  legalReference: z.string().nullable(),
  supersededEffectiveAt: allocationPlanTimestampSchema.nullable(),
  supersededAt: allocationPlanTimestampSchema.nullable(),
  supersededByVersionId: uuidSchema.nullable(),
  officialComplianceEligible: z.literal(false),
});
export type AllocationPlanVersion = z.infer<typeof allocationPlanVersionSchema>;
export const allocationPlanVersionResponseSchema = z.object({
  planVersion: allocationPlanVersionSchema,
});
export const allocationPlanCurrentQuerySchema = z.object({
  effectiveAt: allocationPlanTimestampSchema,
  knownAt: allocationPlanTimestampSchema.optional(),
});
export const allocationPlanResolutionSchema = z.object({
  resolution: z.enum(['planned', 'no_plan']),
  noPlanReason: z.enum(['no_approved_plan', 'schedule_gap']).nullable(),
  effectiveAt: allocationPlanTimestampSchema,
  knownAt: allocationPlanTimestampSchema,
  planVersion: allocationPlanVersionSchema.nullable(),
  entry: plannedDeliveryEntrySchema.nullable(),
});
export const allocationPlanHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(256).optional(),
});
export type AllocationPlanHistoryQuery = z.infer<typeof allocationPlanHistoryQuerySchema>;
export const allocationPlanHistoryResponseSchema = z.object({
  versions: z.array(allocationPlanVersionSchema),
  nextCursor: z.string().nullable(),
});
