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
  'alarm_rule',
  'alarm_catalog',
  'alarm',
  'incident',
  'escalation_policy',
  'report',
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
  'alarm_rule.created',
  'alarm_rule_version.requested',
  'alarm_rule_version.approved',
  'alarm_catalog.created',
  'alarm_catalog_policy.requested',
  'alarm_catalog_policy.approved',
  'alarm.created',
  'alarm.cleared',
  'escalation_policy.created',
  'escalation_policy_version.requested',
  'escalation_policy_version.approved',
  'incident.created',
  'incident.alarm_linked',
  'incident.acknowledged',
  'incident.investigating',
  'incident.assigned',
  'incident.commented',
  'incident.corrective_action',
  'incident.resolved',
  'incident.closed',
  'water_balance_component.created',
  'water_balance_assumption.created',
  'report.generated',
  'report.exported',
]);

export const auditStateMaximumBytes = 256 * 1024;

function serializedStateBytes(value: Record<string, unknown> | null): number {
  if (value === null) return 0;
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

const auditEventBaseSchema = z.object({
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

export const auditEventSchema = auditEventBaseSchema.superRefine((value, context) => {
  if (
    serializedStateBytes(value.oldState) + serializedStateBytes(value.newState) >
    auditStateMaximumBytes
  ) {
    context.addIssue({
      code: 'custom',
      message: `combined audit state must not exceed ${auditStateMaximumBytes} UTF-8 bytes`,
      path: ['newState'],
    });
  }
});
export type AuditEvent = z.infer<typeof auditEventSchema>;

/**
 * List responses deliberately omit the potentially large immutable state
 * payloads. Clients retrieve those only after selecting one audit event.
 */
export const auditEventSummarySchema = auditEventBaseSchema
  .omit({ oldState: true, newState: true })
  .strict();
export type AuditEventSummary = z.infer<typeof auditEventSummarySchema>;

export const auditTerritoryScopeSchema = z.object({
  territoryId: uuidSchema,
  includesDescendants: z.literal(true),
});
export type AuditTerritoryScope = z.infer<typeof auditTerritoryScopeSchema>;

export const listAuditEventsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().min(1).max(128).optional(),
    actorUserId: uuidSchema.optional(),
    action: auditActionSchema.optional(),
    resource: auditResourceSchema.optional(),
    resourceId: uuidSchema.optional(),
    requestId: z.string().trim().min(1).max(256).optional(),
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
  scope: auditTerritoryScopeSchema,
  events: z.array(auditEventSummarySchema),
  nextCursor: z.string().min(1).max(128).nullable(),
});
export type AuditEventsResponse = z.infer<typeof auditEventsResponseSchema>;

export const getAuditEventParamsSchema = z.object({ eventId: uuidSchema });
export const getAuditEventQuerySchema = z.object({ territoryId: uuidSchema.optional() });
export const auditEventResponseSchema = z.object({
  scope: auditTerritoryScopeSchema,
  event: auditEventSchema,
});
export type AuditEventResponse = z.infer<typeof auditEventResponseSchema>;

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
