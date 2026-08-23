import { z } from 'zod';

const uuidSchema = z.uuid();
export const deviceHealthUtcTimestampSchema = z
  .string()
  .datetime({ offset: true })
  .refine(
    (value) => (value.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/i)?.[1]?.length ?? 0) <= 6,
    'timestamps support at most microsecond precision',
  );

/** Communication/device condition is deliberately independent from water-data quality. */
export const deviceConnectionStatusSchema = z.enum(['communicating', 'offline', 'unknown']);
export type DeviceConnectionStatus = z.infer<typeof deviceConnectionStatusSchema>;
export const deviceFaultSchema = z.enum(['reported', 'none', 'unknown']);
export type DeviceFault = z.infer<typeof deviceFaultSchema>;
export const deviceDataConditionSchema = z.enum([
  'current',
  'stale',
  'unreliable',
  'unknown',
  'no_data',
  'unconfigured',
]);
export const deviceFreshnessSchema = z.literal('unconfigured');
const unknownMetricSchema = z.object({ state: z.literal('unknown') });
const measuredMetricSchema = z.object({
  state: z.literal('measured'),
  value: z.string().regex(/^-?(?:0|[1-9]\d{0,5})(?:\.\d{1,6})?$/),
  unit: z.string().min(1).max(16),
});
export const devicePowerSchema = z.union([
  unknownMetricSchema,
  measuredMetricSchema.extend({ unit: z.literal('V') }),
]);
export const deviceSignalSchema = z.union([
  unknownMetricSchema,
  measuredMetricSchema.extend({ unit: z.literal('dBm') }),
]);

export const ingestDeviceHealthEventRequestSchema = z
  .object({
    deviceId: uuidSchema,
    sourceSystem: z.string().trim().min(1).max(128),
    sourceEventId: z.string().trim().min(1).max(256),
    occurredAt: deviceHealthUtcTimestampSchema,
    connectionStatus: deviceConnectionStatusSchema,
    deviceFault: deviceFaultSchema,
    dataCondition: deviceDataConditionSchema.default('unconfigured'),
    faultCode: z.string().trim().min(1).max(128).nullable().default(null),
    power: devicePowerSchema.default({ state: 'unknown' }),
    signal: deviceSignalSchema.default({ state: 'unknown' }),
    provenance: z.string().trim().min(1).max(256),
    dataClassification: z.enum(['synthetic', 'official']),
  })
  .superRefine((value, context) => {
    if (value.deviceFault === 'reported' && !value.faultCode)
      context.addIssue({
        code: 'custom',
        path: ['faultCode'],
        message: 'reported fault requires a fault code',
      });
    if (value.deviceFault !== 'reported' && value.faultCode)
      context.addIssue({
        code: 'custom',
        path: ['faultCode'],
        message: 'fault code only applies to faulted state',
      });
  });
export type IngestDeviceHealthEventRequest = z.infer<typeof ingestDeviceHealthEventRequestSchema>;

export const deviceHealthEventSchema = ingestDeviceHealthEventRequestSchema.extend({
  id: uuidSchema,
  organizationId: uuidSchema,
  territoryId: uuidSchema,
  deviceInstallationId: uuidSchema,
  receivedAt: deviceHealthUtcTimestampSchema,
  synthetic: z.boolean(),
});
export type DeviceHealthEvent = z.infer<typeof deviceHealthEventSchema>;

export const deviceHealthSnapshotSchema = z.object({
  deviceId: uuidSchema,
  organizationId: uuidSchema,
  territoryId: uuidSchema,
  deviceInstallationId: uuidSchema,
  connectionStatus: deviceConnectionStatusSchema,
  deviceFault: deviceFaultSchema,
  lastSeenReceivedAt: deviceHealthUtcTimestampSchema,
  lastObservedAt: deviceHealthUtcTimestampSchema.nullable(),
  dataCondition: deviceDataConditionSchema,
  freshness: deviceFreshnessSchema,
  faultCode: z.string().nullable(),
  power: devicePowerSchema,
  signal: deviceSignalSchema,
  provenance: z.string(),
  dataClassification: z.enum(['synthetic', 'official']),
  synthetic: z.boolean(),
  latestEventId: uuidSchema,
  latestLiveEventId: z.string(),
});
export type DeviceHealthSnapshot = z.infer<typeof deviceHealthSnapshotSchema>;

export const deviceHealthHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(256).optional(),
});
export type DeviceHealthHistoryQuery = z.infer<typeof deviceHealthHistoryQuerySchema>;
export const deviceHealthHistoryResponseSchema = z.object({
  events: z.array(deviceHealthEventSchema),
  nextCursor: z.string().nullable(),
});

export const deviceHealthLiveQuerySchema = z.object({
  deviceId: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(250).default(100),
});
export type DeviceHealthLiveQuery = z.infer<typeof deviceHealthLiveQuerySchema>;

export const deviceHealthLiveEventSchema = z.object({
  id: z.string(),
  event: z.literal('device-health'),
  data: deviceHealthEventSchema,
});
export type DeviceHealthLiveEvent = z.infer<typeof deviceHealthLiveEventSchema>;
