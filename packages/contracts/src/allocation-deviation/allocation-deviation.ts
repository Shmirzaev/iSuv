import { z } from 'zod';
import {
  allocationPlanTimestampSchema,
  plannedDeliveryEntrySchema,
} from '../allocation-plans/allocation-plans.js';
import {
  derivedVolumeResultSchema,
  exactRationalSchema,
  quantityDerivationMethodSchema,
} from '../quantity-derivation/quantity-derivation.js';

const uuid = z.uuid();
const decimal = z.string().regex(/^(?:0|[1-9]\d{0,17})(?:\.\d{1,12})?$/);
function timestampMicros(value: string): bigint {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/i.exec(
    value,
  );
  if (!match) return 0n;
  return (
    BigInt(Date.parse(`${match[1]}${match[3]}`)) * 1000n + BigInt((match[2] ?? '').padEnd(6, '0'))
  );
}
const percentRationalSchema = z.object({
  numerator: z.string().regex(/^-?\d+$/),
  denominator: z.string().regex(/^\d+$/),
  unit: z.literal('percent'),
});
export const allocationEntryMeasurementBindingSchema = z.object({
  id: uuid,
  entryId: uuid,
  stationId: uuid,
  sensorId: uuid,
  deviceInstallationId: uuid,
  method: quantityDerivationMethodSchema,
  referencePlane: z.enum(['upstream', 'downstream', 'on_section']),
  purpose: z.literal('section_delivery'),
  provenance: z.string().trim().min(1).max(256),
  createdByUserId: uuid,
  creationReason: z.string().trim().min(1).max(1000),
  createdRequestId: z.string().trim().min(1).max(256),
  createdAt: allocationPlanTimestampSchema,
  dataClassification: z.literal('synthetic'),
  officialComplianceEligible: z.literal(false),
});
export type AllocationEntryMeasurementBinding = z.infer<
  typeof allocationEntryMeasurementBindingSchema
>;
export const createAllocationEntryMeasurementBindingRequestSchema = z.object({
  stationId: uuid,
  sensorId: uuid,
  deviceInstallationId: uuid,
  method: quantityDerivationMethodSchema,
  referencePlane: z.enum(['upstream', 'downstream', 'on_section']),
  provenance: z.string().trim().min(1).max(256),
  reason: z.string().trim().min(1).max(1000),
});
export type CreateAllocationEntryMeasurementBindingRequest = z.infer<
  typeof createAllocationEntryMeasurementBindingRequestSchema
>;
export const allocationEntryMeasurementBindingResponseSchema = z.object({
  binding: allocationEntryMeasurementBindingSchema,
});
export const sectionTolerancePolicyRecordSchema = z.object({
  id: uuid,
  organizationId: uuid,
  territoryId: uuid,
  waterSectionId: uuid,
  provenance: z.string().trim().min(1).max(256),
  createdByUserId: uuid,
  creationReason: z.string().trim().min(1).max(1000),
  createdRequestId: z.string().trim().min(1).max(256),
  createdAt: allocationPlanTimestampSchema,
  dataClassification: z.literal('synthetic'),
  officialComplianceEligible: z.literal(false),
});
export type SectionTolerancePolicyRecord = z.infer<typeof sectionTolerancePolicyRecordSchema>;
export const createSectionTolerancePolicyRequestSchema = z.object({
  waterSectionId: uuid,
  provenance: z.string().trim().min(1).max(256),
  reason: z.string().trim().min(1).max(1000),
});
export type CreateSectionTolerancePolicyRequest = z.infer<
  typeof createSectionTolerancePolicyRequestSchema
>;
export const sectionTolerancePolicyRecordResponseSchema = z.object({
  policy: sectionTolerancePolicyRecordSchema,
});
const toleranceLimitsSchema = z
  .object({
    underAbsoluteM3: decimal.nullable().optional(),
    overAbsoluteM3: decimal.nullable().optional(),
    underPercent: decimal.nullable().optional(),
    overPercent: decimal.nullable().optional(),
    combination: z.enum(['all', 'any']),
    appliesToZeroPlan: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.underAbsoluteM3 == null && value.underPercent == null)
      context.addIssue({
        code: 'custom',
        path: ['underAbsoluteM3'],
        message: 'under limit required',
      });
    if (value.overAbsoluteM3 == null && value.overPercent == null)
      context.addIssue({
        code: 'custom',
        path: ['overAbsoluteM3'],
        message: 'over limit required',
      });
  });
export const requestSectionTolerancePolicyVersionRequestSchema = toleranceLimitsSchema
  .extend({
    effectiveFrom: allocationPlanTimestampSchema,
    effectiveUntil: allocationPlanTimestampSchema,
    reason: z.string().trim().min(1).max(1000),
  })
  .superRefine((value, context) => {
    if (timestampMicros(value.effectiveUntil) <= timestampMicros(value.effectiveFrom))
      context.addIssue({
        code: 'custom',
        path: ['effectiveUntil'],
        message: 'must be after effectiveFrom',
      });
  });
export type RequestSectionTolerancePolicyVersionRequest = z.infer<
  typeof requestSectionTolerancePolicyVersionRequestSchema
>;
export const approveSectionTolerancePolicyVersionRequestSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});
export type ApproveSectionTolerancePolicyVersionRequest = z.infer<
  typeof approveSectionTolerancePolicyVersionRequestSchema
>;
export const sectionTolerancePolicyVersionSchema = z.object({
  id: uuid,
  policyId: uuid,
  version: z.number().int().positive(),
  status: z.enum(['requested', 'approved']),
  effectiveFrom: allocationPlanTimestampSchema,
  effectiveUntil: allocationPlanTimestampSchema.nullable(),
  underAbsoluteM3: decimal.nullable(),
  overAbsoluteM3: decimal.nullable(),
  underPercent: decimal.nullable(),
  overPercent: decimal.nullable(),
  combination: z.enum(['all', 'any']),
  appliesToZeroPlan: z.boolean(),
  requestedByUserId: uuid,
  requestedAt: allocationPlanTimestampSchema,
  requestReason: z.string().trim().min(1).max(1000),
  approvedByUserId: uuid.nullable(),
  approvedAt: allocationPlanTimestampSchema.nullable(),
  approvalReason: z.string().nullable(),
  dataClassification: z.literal('synthetic'),
  officialComplianceEligible: z.literal(false),
});
export type SectionTolerancePolicyVersion = z.infer<typeof sectionTolerancePolicyVersionSchema>;
export const sectionTolerancePolicyVersionResponseSchema = z.object({
  version: sectionTolerancePolicyVersionSchema,
});
export const sectionTolerancePolicySchema = z.object({
  id: uuid,
  versionId: uuid,
  waterSectionId: uuid,
  effectiveFrom: allocationPlanTimestampSchema,
  effectiveUntil: allocationPlanTimestampSchema.nullable(),
  knownAt: allocationPlanTimestampSchema,
  underAbsoluteM3: decimal.nullable(),
  overAbsoluteM3: decimal.nullable(),
  underPercent: decimal.nullable(),
  overPercent: decimal.nullable(),
  combination: z.enum(['all', 'any']),
  appliesToZeroPlan: z.boolean(),
  provenance: z.string().trim().min(1).max(256),
  dataClassification: z.literal('synthetic'),
  officialComplianceEligible: z.literal(false),
});
export type SectionTolerancePolicy = z.infer<typeof sectionTolerancePolicySchema>;
export const allocationDeviationQuerySchema = z
  .object({
    intervalStart: allocationPlanTimestampSchema,
    intervalEnd: allocationPlanTimestampSchema,
    knownAt: allocationPlanTimestampSchema.optional(),
  })
  .superRefine((value, issue) => {
    if (timestampMicros(value.intervalEnd) <= timestampMicros(value.intervalStart))
      issue.addIssue({
        code: 'custom',
        path: ['intervalEnd'],
        message: 'must be after intervalStart',
      });
  });
const base = {
  interval: z.object({ start: allocationPlanTimestampSchema, end: allocationPlanTimestampSchema }),
  knownAt: allocationPlanTimestampSchema,
  dataClassification: z.literal('synthetic'),
  officialComplianceEligible: z.literal(false),
};
export const allocationDeviationResultSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('computed'),
    ...base,
    condition: z.enum(['under', 'within', 'over', 'unassessable']),
    planVersionId: uuid,
    planEntryId: uuid,
    plannedEntry: plannedDeliveryEntrySchema,
    binding: allocationEntryMeasurementBindingSchema,
    tolerance: sectionTolerancePolicySchema,
    actual: derivedVolumeResultSchema,
    delta: exactRationalSchema,
    absoluteDelta: exactRationalSchema,
    percent: percentRationalSchema.nullable(),
    percentageReason: z.literal('planned_volume_zero').nullable(),
  }),
  z.object({
    outcome: z.enum([
      'no_approved_plan',
      'schedule_gap',
      'plan_interval_not_exact',
      'missing_measurement_binding',
      'no_approved_tolerance',
      'actual_not_eligible',
      'estimated_not_eligible',
    ]),
    ...base,
    condition: z.literal('unassessable'),
    planVersionId: uuid.nullable(),
    planEntryId: uuid.nullable(),
    plannedEntry: plannedDeliveryEntrySchema.nullable(),
    binding: allocationEntryMeasurementBindingSchema.nullable(),
    tolerance: sectionTolerancePolicySchema.nullable(),
    actual: derivedVolumeResultSchema.nullable(),
    delta: z.null(),
    absoluteDelta: z.null(),
    percent: z.null(),
    percentageReason: z.null(),
  }),
]);
export type AllocationDeviationResult = z.infer<typeof allocationDeviationResultSchema>;
export const allocationDeviationResponseSchema = z.object({
  result: allocationDeviationResultSchema,
});
