import { z } from 'zod';
import { authorizationGrantSchema, userRoleSchema } from '../identity/identity.js';

const utcTimestampSchema = z.string().datetime({ offset: true });
const uuidSchema = z.uuid();

export const auditDataClassificationSchema = z.enum(['synthetic', 'official']);
export const auditResourceSchema = z.enum([
  'user_role_grant',
  'observation',
  'validation_profile',
  'allocation_plan',
  'quantity_model',
  'tolerance_policy',
  'water_balance_model',
]);
export const auditActionSchema = z.enum([
  'user_role_grant.created',
  'user_role_grant.revoked',
  'user_role_grant.cancelled',
  'observation.corrected',
  'observation.rejected',
  'observation.estimated',
  'observation.automatically_validated',
  'validation_profile.created',
  'validation_profile_version.created',
  'validation_profile_version.approved',
  'allocation_plan.created',
  'allocation_plan_version.created',
  'allocation_plan_version.requested',
  'allocation_plan_version.approved',
  'allocation_plan_version.superseded',
  'allocation_plan_entry.created',
  'rating_curve.created',
  'rating_curve_version.approved',
  'integration_coverage_policy.created',
  'integration_coverage_policy_version.approved',
  'allocation_plan_entry_measurement_binding.created',
  'section_tolerance_policy.created',
  'section_tolerance_policy_version.requested',
  'section_tolerance_policy_version.approved',
  'water_balance_model.created',
  'water_balance_version.requested',
  'water_balance_version.approved',
  'water_balance_component.created',
  'water_balance_assumption.created',
]);

export const auditEventSchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  territoryId: uuidSchema,
  actorUserId: uuidSchema,
  actorOrganizationId: uuidSchema,
  action: auditActionSchema,
  resource: auditResourceSchema,
  resourceId: uuidSchema,
  oldState: z.record(z.string(), z.unknown()).nullable(),
  newState: z.record(z.string(), z.unknown()).nullable(),
  reason: z.string().min(1).max(2000),
  requestId: z.string().min(1).max(256),
  occurredAt: utcTimestampSchema,
  dataClassification: auditDataClassificationSchema,
  provenance: z.string().min(1).max(256),
});
export type AuditEvent = z.infer<typeof auditEventSchema>;

export const listAuditEventsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).max(128).optional(),
    actorUserId: uuidSchema.optional(),
    action: auditActionSchema.optional(),
    resource: auditResourceSchema.optional(),
    territoryId: uuidSchema.optional(),
    occurredFrom: utcTimestampSchema.optional(),
    occurredUntil: utcTimestampSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.occurredFrom && value.occurredUntil && value.occurredUntil <= value.occurredFrom) {
      context.addIssue({
        code: 'custom',
        message: 'occurredUntil must be after occurredFrom',
        path: ['occurredUntil'],
      });
    }
  });
export type ListAuditEventsQuery = z.infer<typeof listAuditEventsQuerySchema>;

export const auditEventsResponseSchema = z.object({
  events: z.array(auditEventSchema),
  nextCursor: z.string().min(1).max(128).nullable(),
});
export type AuditEventsResponse = z.infer<typeof auditEventsResponseSchema>;

export const createRoleGrantRequestSchema = z
  .object({
    userId: uuidSchema,
    role: userRoleSchema,
    scope: z.enum(['system', 'national', 'territory']),
    territoryId: uuidSchema.nullable(),
    effectiveFrom: utcTimestampSchema,
    effectiveUntil: utcTimestampSchema.nullable().optional(),
    reason: z.string().trim().min(1).max(2000),
  })
  .superRefine((value, context) => {
    if ((value.scope === 'territory') !== (value.territoryId !== null)) {
      context.addIssue({
        code: 'custom',
        message: 'territoryId is required only for territory-scoped grants',
        path: ['territoryId'],
      });
    }
    if (value.effectiveUntil && value.effectiveUntil <= value.effectiveFrom) {
      context.addIssue({
        code: 'custom',
        message: 'effectiveUntil must be after effectiveFrom',
        path: ['effectiveUntil'],
      });
    }
    const roleScope =
      (value.role === 'system_admin' && value.scope === 'system' && value.territoryId === null) ||
      (value.role === 'national_admin' &&
        value.scope === 'national' &&
        value.territoryId === null) ||
      (!['system_admin', 'national_admin'].includes(value.role) &&
        value.scope === 'territory' &&
        value.territoryId !== null);
    if (!roleScope) {
      context.addIssue({
        code: 'custom',
        message: 'role and scope are incompatible',
        path: ['scope'],
      });
    }
  });
export type CreateRoleGrantRequest = z.infer<typeof createRoleGrantRequestSchema>;

export const revokeRoleGrantRequestSchema = z
  .object({
    operation: z.literal('revoke'),
    effectiveUntil: utcTimestampSchema,
    reason: z.string().trim().min(1).max(2000),
  })
  .or(
    z.object({
      operation: z.literal('cancel'),
      reason: z.string().trim().min(1).max(2000),
    }),
  );
export type RevokeRoleGrantRequest = z.infer<typeof revokeRoleGrantRequestSchema>;

export const roleGrantMutationResponseSchema = z.object({
  grant: authorizationGrantSchema,
  auditEvent: auditEventSchema,
});
export type RoleGrantMutationResponse = z.infer<typeof roleGrantMutationResponseSchema>;
