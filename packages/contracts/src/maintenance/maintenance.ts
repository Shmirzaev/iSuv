import { z } from 'zod';

const uuid = z.uuid();
const timestamp = z
  .string()
  .datetime({ offset: true })
  .refine(
    (value) => !/\.\d{7,}/.test(value),
    'UTC timestamp precision must not exceed microseconds',
  );

function timestampMicros(value: string): bigint {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/i.exec(
    value,
  );
  if (!match) return 0n;
  return (
    BigInt(Date.parse(`${match[1]}${match[3]}`)) * 1000n + BigInt((match[2] ?? '').padEnd(6, '0'))
  );
}

export const maintenanceRecordTypeSchema = z.enum([
  'inspection',
  'preventive',
  'corrective',
  'calibration',
]);
export const maintenanceRecordStatusSchema = z.enum([
  'planned',
  'scheduled',
  'in_progress',
  'completed',
  'cancelled',
]);

/** Immutable, explicitly synthetic maintenance record. It is never a control command. */
export const maintenanceRecordSchema = z
  .object({
    id: uuid,
    version: z.literal(1),
    organizationId: uuid,
    territoryId: uuid,
    deviceId: uuid,
    type: maintenanceRecordTypeSchema,
    status: maintenanceRecordStatusSchema,
    scheduledInterval: z.object({ start: timestamp, end: timestamp }).strict(),
    startedAt: timestamp.nullable(),
    completedAt: timestamp.nullable(),
    recordedAt: timestamp,
    createdAt: timestamp,
    auditEventId: uuid,
    provenance: z.string().trim().min(1),
    dataClassification: z.literal('synthetic'),
    officialRecord: z.literal(false),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      timestampMicros(value.scheduledInterval.end) <= timestampMicros(value.scheduledInterval.start)
    )
      context.addIssue({
        code: 'custom',
        path: ['scheduledInterval'],
        message: 'scheduled interval must be positive',
      });
    if (
      value.startedAt !== null &&
      timestampMicros(value.startedAt) < timestampMicros(value.scheduledInterval.start)
    )
      context.addIssue({
        code: 'custom',
        path: ['startedAt'],
        message: 'start cannot precede scheduled interval',
      });
    if (
      value.completedAt !== null &&
      (value.startedAt === null ||
        timestampMicros(value.completedAt) < timestampMicros(value.startedAt))
    )
      context.addIssue({
        code: 'custom',
        path: ['completedAt'],
        message: 'completion requires a prior start',
      });
    if ((value.status === 'completed') !== (value.completedAt !== null))
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'completed status and completion timestamp must agree',
      });
    if (timestampMicros(value.recordedAt) < timestampMicros(value.createdAt))
      context.addIssue({
        code: 'custom',
        path: ['recordedAt'],
        message: 'recorded time cannot precede creation time',
      });
  });
export type MaintenanceRecord = z.infer<typeof maintenanceRecordSchema>;

export const maintenanceHistorySchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('synthetic_history'),
      records: z.array(maintenanceRecordSchema).max(10),
      source: z.literal('synthetic_scenario'),
      reason: z.null(),
    })
    .strict(),
  z
    .object({
      state: z.literal('unconfigured'),
      records: z.tuple([]),
      source: z.literal('unconfigured'),
      reason: z.string().trim().min(1),
    })
    .strict(),
]);
export type MaintenanceHistory = z.infer<typeof maintenanceHistorySchema>;
