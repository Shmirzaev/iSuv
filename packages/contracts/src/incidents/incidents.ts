import { z } from 'zod';
import { alarmEventTypeSchema, alarmSeveritySchema } from '../alarms/alarms.js';
import { quantityDerivationTimestampSchema } from '../quantity-derivation/quantity-derivation.js';

const uuid = z.uuid();
const reason = z.string().trim().min(1).max(2000);
const label = z.string().trim().min(1).max(256);
const micros = z.string().regex(/^\d+$/, 'microseconds must be an unsigned integer');
const boundedTargetMicros = z
  .string()
  .regex(/^[1-9]\d*$/, 'target microseconds must be positive')
  .refine((value) => BigInt(value) <= 31_536_000_000_000n, 'target must not exceed one year');
function timestampMicros(value: string): bigint {
  const match = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/i.exec(value);
  if (!match) return 0n;
  return (
    BigInt(Date.parse(`${match[1]}${match[3]}`)) * 1000n + BigInt((match[2] ?? '').padEnd(6, '0'))
  );
}
export const incidentStatusSchema = z.enum([
  'open',
  'acknowledged',
  'investigating',
  'resolved',
  'closed',
]);
export const incidentMetricStateSchema = z.enum([
  'unconfigured',
  'acknowledgement_pending',
  'acknowledgement_overdue',
  'acknowledgement_met',
  'resolution_pending',
  'resolution_overdue',
  'resolution_met',
]);
export const createEscalationPolicyRequestSchema = z
  .object({
    territoryId: uuid,
    eventType: alarmEventTypeSchema,
    severity: alarmSeveritySchema,
    title: label,
    provenance: label,
    reason,
  })
  .strict();
export const requestEscalationPolicyVersionRequestSchema = z
  .object({
    effectiveFrom: quantityDerivationTimestampSchema,
    effectiveUntil: quantityDerivationTimestampSchema,
    tier: z.number().int().min(1).max(9),
    procedure: reason,
    acknowledgementTargetMicroseconds: boundedTargetMicros,
    resolutionTargetMicroseconds: boundedTargetMicros,
    reason,
  })
  .strict()
  .superRefine((v, c) => {
    if (timestampMicros(v.effectiveUntil) <= timestampMicros(v.effectiveFrom))
      c.addIssue({
        code: 'custom',
        path: ['effectiveUntil'],
        message: 'must be after effectiveFrom',
      });
  });
export const approveEscalationPolicyVersionRequestSchema = z.object({ reason }).strict();
export const escalationPolicySchema = z
  .object({
    id: uuid,
    organizationId: uuid,
    territoryId: uuid,
    eventType: alarmEventTypeSchema,
    severity: alarmSeveritySchema,
    title: label,
    provenance: label,
    dataClassification: z.literal('synthetic'),
    officialComplianceEligible: z.literal(false),
    createdByUserId: uuid,
    createdAt: quantityDerivationTimestampSchema,
  })
  .strict();
export const escalationPolicyResponseSchema = z.object({ policy: escalationPolicySchema }).strict();
export const escalationPolicyVersionSchema = z
  .object({
    id: uuid,
    policyId: uuid,
    version: z.number().int().positive(),
    organizationId: uuid,
    territoryId: uuid,
    eventType: alarmEventTypeSchema,
    severity: alarmSeveritySchema,
    title: label,
    status: z.enum(['requested', 'approved']),
    effectiveFrom: quantityDerivationTimestampSchema,
    effectiveUntil: quantityDerivationTimestampSchema,
    tier: z.number().int().min(1),
    procedure: reason,
    acknowledgementTargetMicroseconds: micros,
    resolutionTargetMicroseconds: micros,
    provenance: label,
    dataClassification: z.literal('synthetic'),
    officialComplianceEligible: z.literal(false),
    requestedByUserId: uuid,
    requestedAt: quantityDerivationTimestampSchema,
    requestReason: reason,
    approvedByUserId: uuid.nullable(),
    approvedAt: quantityDerivationTimestampSchema.nullable(),
    approvalReason: z.string().nullable(),
  })
  .strict();
export const escalationPolicyVersionResponseSchema = z
  .object({ policyVersion: escalationPolicyVersionSchema })
  .strict();
export const escalationPolicyReadQuerySchema = z
  .object({
    effectiveAt: quantityDerivationTimestampSchema,
    knownAt: quantityDerivationTimestampSchema.optional(),
  })
  .strict();
export const createIncidentRequestSchema = z.object({ alarmId: uuid, reason }).strict();
export const linkIncidentAlarmRequestSchema = z.object({ alarmId: uuid, reason }).strict();
export const incidentActionRequestSchema = z.object({ reason }).strict();
export const assignIncidentRequestSchema = z.object({ assigneeUserId: uuid, reason }).strict();
export const incidentCommentRequestSchema = z.object({ body: reason, reason }).strict();
export const incidentCorrectiveActionRequestSchema = z.object({ body: reason, reason }).strict();
export const incidentReadQuerySchema = z
  .object({ evaluatedAt: quantityDerivationTimestampSchema.optional() })
  .strict();
export const incidentTimelineEntrySchema = z
  .object({
    sequence: z.number().int().positive(),
    kind: z.enum([
      'created',
      'alarm_linked',
      'acknowledged',
      'investigating',
      'assigned',
      'commented',
      'corrective_action',
      'resolved',
      'closed',
    ]),
    actorUserId: uuid,
    reason,
    body: z.string().nullable(),
    assigneeUserId: uuid.nullable(),
    alarmId: uuid.nullable(),
    occurredAt: quantityDerivationTimestampSchema,
    requestId: z.string().min(1).max(256),
  })
  .strict();
export const incidentSchema = z
  .object({
    id: uuid,
    organizationId: uuid,
    territoryId: uuid,
    status: incidentStatusSchema,
    primaryAlarmId: uuid,
    linkedAlarmIds: z.array(uuid).min(1),
    assignedUserId: uuid.nullable(),
    acknowledgedByUserId: uuid.nullable(),
    acknowledgedAt: quantityDerivationTimestampSchema.nullable(),
    resolvedAt: quantityDerivationTimestampSchema.nullable(),
    closedAt: quantityDerivationTimestampSchema.nullable(),
    escalationPolicyId: uuid.nullable(),
    escalationPolicyVersionId: uuid.nullable(),
    escalationTier: z.number().int().min(1).nullable(),
    escalationProcedure: z.string().nullable(),
    acknowledgementDueAt: quantityDerivationTimestampSchema.nullable(),
    resolutionDueAt: quantityDerivationTimestampSchema.nullable(),
    dataClassification: z.literal('synthetic'),
    officialComplianceEligible: z.literal(false),
    createdAt: quantityDerivationTimestampSchema,
    timeline: z.array(incidentTimelineEntrySchema),
  })
  .strict();
export const incidentMetricsSchema = z
  .object({
    evaluatedAt: quantityDerivationTimestampSchema,
    acknowledgement: z
      .object({
        state: incidentMetricStateSchema,
        targetMicroseconds: micros.nullable(),
        elapsedMicroseconds: micros,
        dueAt: quantityDerivationTimestampSchema.nullable(),
      })
      .strict(),
    resolution: z
      .object({
        state: incidentMetricStateSchema,
        targetMicroseconds: micros.nullable(),
        elapsedMicroseconds: micros,
        dueAt: quantityDerivationTimestampSchema.nullable(),
      })
      .strict(),
  })
  .strict();
export const incidentResponseSchema = z
  .object({ incident: incidentSchema, metrics: incidentMetricsSchema })
  .strict();
export type CreateEscalationPolicyRequest = z.infer<typeof createEscalationPolicyRequestSchema>;
export type RequestEscalationPolicyVersionRequest = z.infer<
  typeof requestEscalationPolicyVersionRequestSchema
>;
export type CreateIncidentRequest = z.infer<typeof createIncidentRequestSchema>;
