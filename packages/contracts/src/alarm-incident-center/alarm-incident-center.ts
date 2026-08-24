import { z } from 'zod';
import {
  alarmEventTypeSchema,
  alarmSeveritySchema,
  automaticAlarmStateSchema,
  systemDeviceConditionSchema,
  waterConditionSchema,
} from '../alarms/alarms.js';
import { incidentMetricStateSchema, incidentStatusSchema } from '../incidents/incidents.js';

const uuid = z.uuid();
const timestamp = z.string().datetime({ offset: true });
const micros = z.string().regex(/^\d+$/);
const provenance = z
  .object({
    dataClassification: z.literal('synthetic'),
    officialComplianceEligible: z.literal(false),
    label: z.string().min(1),
  })
  .strict();

export const alarmIncidentCenterQuerySchema = z
  .object({
    territoryId: uuid.optional(),
    automaticState: automaticAlarmStateSchema.optional(),
    incidentStatus: incidentStatusSchema.optional(),
    severity: alarmSeveritySchema.optional(),
    eventType: alarmEventTypeSchema.optional(),
    waterCondition: waterConditionSchema.optional(),
    systemDeviceCondition: systemDeviceConditionSchema.optional(),
    assignment: z.enum(['assigned', 'unassigned']).optional(),
    alarmId: uuid.optional(),
    incidentId: uuid.optional(),
    evidenceAssessment: z
      .enum(['assessable', 'unassessable', 'missing', 'pending', 'deferred'])
      .optional(),
    limit: z.coerce.number().int().min(1).max(50).default(25),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict()
  .superRefine((value, issue) => {
    if (value.alarmId && value.incidentId)
      issue.addIssue({
        code: 'custom',
        path: ['incidentId'],
        message: 'select either an alarm or an incident, not both',
      });
  });
export type AlarmIncidentCenterQuery = z.infer<typeof alarmIncidentCenterQuerySchema>;

const capabilitySchema = z
  .object({
    allowed: z.boolean(),
    disabledReason: z.string().min(1).nullable(),
  })
  .strict();
const escalationSchema = z
  .object({
    state: z.enum(['configured', 'unconfigured']),
    tier: z.number().int().min(1).nullable(),
    procedure: z.string().nullable(),
    acknowledgementDueAt: timestamp.nullable(),
    resolutionDueAt: timestamp.nullable(),
    acknowledgementElapsedMicroseconds: micros.nullable(),
    resolutionElapsedMicroseconds: micros.nullable(),
    provenance: z.string().nullable(),
  })
  .strict();
const evidenceSchema = z
  .object({
    assessment: z.enum(['assessable', 'unassessable', 'missing', 'pending', 'deferred']),
    effectiveAt: timestamp.nullable(),
    knownAt: timestamp.nullable(),
    detectedAt: timestamp,
    signalRunId: uuid.nullable(),
    latestEvidenceStatus: z.enum(['assessable', 'unassessable']).nullable(),
    result: z.record(z.string(), z.unknown()).nullable(),
    reason: z.string().nullable(),
    qualityState: z.enum(['valid', 'estimated', 'unknown', 'unavailable']),
    qualityReason: z.string().nullable(),
    ruleId: uuid,
    catalogVersionId: uuid,
    unitBoundary: z.enum(['stage_m', 'discharge_m3s', 'volume_m3', 'not_applicable']),
    provenance: provenance,
  })
  .strict();
const timelineSchema = z
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
    reason: z.string().min(1),
    body: z.string().nullable(),
    assigneeUserId: uuid.nullable(),
    alarmId: uuid.nullable(),
    occurredAt: timestamp,
    requestId: z.string().min(1),
  })
  .strict();
export const alarmIncidentCenterItemSchema = z
  .object({
    alarmId: uuid,
    incidentId: uuid.nullable(),
    territory: z.object({ id: uuid, code: z.string().min(1), name: z.string().min(1) }).strict(),
    eventType: alarmEventTypeSchema,
    severity: alarmSeveritySchema,
    automaticState: automaticAlarmStateSchema,
    incidentStatus: incidentStatusSchema.nullable(),
    waterCondition: waterConditionSchema,
    systemDeviceCondition: systemDeviceConditionSchema,
    detectedAt: timestamp,
    clearedAt: timestamp.nullable(),
    assignedUserId: uuid.nullable(),
    evidence: evidenceSchema,
    escalation: escalationSchema,
    capabilities: z
      .object({
        createIncident: capabilitySchema,
        acknowledge: capabilitySchema,
        investigate: capabilitySchema,
        assign: capabilitySchema,
        comment: capabilitySchema,
        correctiveAction: capabilitySchema,
        resolve: capabilitySchema,
        close: capabilitySchema,
      })
      .strict(),
    provenance: provenance,
  })
  .strict();
export type AlarmIncidentCenterItem = z.infer<typeof alarmIncidentCenterItemSchema>;

export const alarmIncidentCenterResponseSchema = z
  .object({
    referenceAt: timestamp,
    knownAt: timestamp,
    presentationTimeZone: z.literal('Asia/Tashkent'),
    scope: z
      .object({ territoryId: uuid, queueDenominator: z.number().int().nonnegative() })
      .strict(),
    items: z.array(alarmIncidentCenterItemSchema),
    panel: z
      .object({
        item: alarmIncidentCenterItemSchema,
        linkedAlarms: z
          .array(
            z
              .object({
                alarmId: uuid,
                automaticState: automaticAlarmStateSchema,
                detectedAt: timestamp,
                clearedAt: timestamp.nullable(),
              })
              .strict(),
          )
          .max(50),
        timeline: z.array(timelineSchema).max(200),
        metrics: z
          .object({
            acknowledgement: z
              .object({
                state: incidentMetricStateSchema,
                elapsedMicroseconds: micros,
                dueAt: timestamp.nullable(),
              })
              .strict(),
            resolution: z
              .object({
                state: incidentMetricStateSchema,
                elapsedMicroseconds: micros,
                dueAt: timestamp.nullable(),
              })
              .strict(),
          })
          .strict()
          .nullable(),
      })
      .strict()
      .nullable(),
    assignmentCandidates: z.array(z.object({ id: uuid, displayName: z.string().min(1) }).strict()),
    nextCursor: z.string().nullable(),
    scenario: provenance,
  })
  .strict();
export type AlarmIncidentCenterResponse = z.infer<typeof alarmIncidentCenterResponseSchema>;
