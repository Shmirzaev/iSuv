import { z } from 'zod';

const utcTimestampSchema = z
  .string()
  .datetime({ offset: true })
  .refine(
    (value) => (value.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/i)?.[1]?.length ?? 0) <= 6,
    'timestamps support at most microsecond precision',
  );
export const syntheticTelemetryScenarioSchema = z.enum([
  'normal',
  'over',
  'under',
  'stale',
  'offline',
  'spike',
  'frozen',
  'device_fault',
  'reset',
  'rollover',
]);
export type SyntheticTelemetryScenario = z.infer<typeof syntheticTelemetryScenarioSchema>;
export const simulatorRequestSchema = z.object({
  seed: z.string().min(1).max(128).default('synthetic-water-platform'),
  at: utcTimestampSchema,
  step: z.coerce.number().int().min(0).max(10000).default(0),
  scenario: syntheticTelemetryScenarioSchema.default('normal'),
});
export type SimulatorRequest = z.infer<typeof simulatorRequestSchema>;
export const simulatorPreviewRequestSchema = simulatorRequestSchema.extend({
  limit: z.coerce.number().int().min(1).max(249).default(249),
});
export type SimulatorPreviewRequest = z.infer<typeof simulatorPreviewRequestSchema>;
export const telemetryStatusSchema = z
  .object({
    hotspot: z.number().int().min(1).max(83),
    deviceId: z.uuid(),
    /** A raw device-status fact, not a water-data quality or compliance outcome. */
    status: z.enum(['offline', 'device_fault']),
    observedAt: utcTimestampSchema,
    sourceEventId: z.string().min(1).max(256),
    scenario: z.enum(['offline', 'device_fault']),
    provenance: z.literal('synthetic'),
    faultCode: z.string().min(1).max(128).nullable(),
  })
  .superRefine((value, context) => {
    if (value.status !== value.scenario)
      context.addIssue({
        code: 'custom',
        path: ['scenario'],
        message: 'status and scenario must match',
      });
    if (value.status === 'offline' && value.faultCode !== null)
      context.addIssue({
        code: 'custom',
        path: ['faultCode'],
        message: 'offline status cannot carry a fault code',
      });
    if (value.status === 'device_fault' && value.faultCode === null)
      context.addIssue({
        code: 'custom',
        path: ['faultCode'],
        message: 'device fault status requires a fault code',
      });
  });
export type TelemetryStatus = z.infer<typeof telemetryStatusSchema>;
export const syntheticTelemetryPointSchema = z.object({
  hotspot: z.number().int().min(1).max(83),
  deviceId: z.uuid(),
  sensorId: z.uuid(),
  kind: z.enum(['stage', 'discharge', 'accumulated_volume']),
  unit: z.enum(['m', 'm3/s', 'm3']),
  value: z.string(),
  observedAt: utcTimestampSchema,
  sourceEventId: z.string().min(1).max(256),
  scenario: syntheticTelemetryScenarioSchema,
  qualityState: z.enum(['unknown', 'suspect', 'invalid']),
  qualityReason: z.string().min(1),
  totalizerTransition: z
    .enum(['normal', 'reset_reported', 'rollover_reported', 'unknown'])
    .nullable(),
});
export const simulatorEnvelopeSchema = z.object({
  version: z.literal('v1'),
  classification: z.literal('synthetic'),
  seed: z.string(),
  scenario: syntheticTelemetryScenarioSchema,
  generatedAt: utcTimestampSchema,
  points: z.array(syntheticTelemetryPointSchema),
  statuses: z.array(telemetryStatusSchema),
});
export const telemetryBatchResultSchema = z.object({
  accepted: z.number().int().nonnegative(),
  idempotent: z.number().int().nonnegative(),
  gaps: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(),
  replayed: z.number().int().nonnegative(),
  overflowed: z.number().int().nonnegative(),
  /** Typed handoff only; P2-004 owns durable device-health projection/streaming. */
  statusEvents: z.array(telemetryStatusSchema),
});
export type TelemetryBatchResult = z.infer<typeof telemetryBatchResultSchema>;
