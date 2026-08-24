import { z } from 'zod';

const uuid = z.uuid();
const timestamp = z
  .string()
  .datetime({ offset: true })
  .refine(
    (value) => !/\.\d{7,}/.test(value),
    'UTC timestamp precision must not exceed microseconds',
  );
const decimal = z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/);
const dataState = z.enum(['reported', 'unreliable', 'no_data']);
const quality = z.enum(['unknown', 'valid', 'suspect', 'invalid', 'estimated']);
const connection = z.enum(['communicating', 'offline', 'unknown']);
const fault = z.enum(['reported', 'none', 'unknown']);
const attention = z.enum(['attention', 'unreliable', 'no_data', 'reported']);
const kind = z.enum(['stage', 'discharge', 'accumulated_volume']);

export const liveOperationsQuerySchema = z
  .object({
    territoryId: uuid.optional(),
    measurementKind: kind.optional(),
    connection: connection.optional(),
    fault: fault.optional(),
    dataState: dataState.optional(),
    quality: quality.optional(),
    attention: attention.optional(),
    waterwayId: uuid.optional(),
    sectionId: uuid.optional(),
    stationId: uuid.optional(),
    deviceId: uuid.optional(),
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export type LiveOperationsQuery = z.infer<typeof liveOperationsQuerySchema>;
export const liveOperationsScopeQuerySchema = z.object({ territoryId: uuid.optional() }).strict();

const sourceSchema = z
  .object({
    kind: z.enum(['synthetic_scenario', 'canonical_observation', 'canonical_device_health']),
    label: z.string().min(1),
    official: z.boolean(),
    provenance: z.string().min(1),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.kind === 'synthetic_scenario' && value.official)
      context.addIssue({
        code: 'custom',
        path: ['official'],
        message: 'synthetic scenario sources are never official',
      });
  });
const quantitySchema = z
  .object({
    sensorId: uuid,
    kind,
    value: decimal.nullable(),
    unit: z.enum(['m', 'm3/s', 'm3']),
    dataState,
    quality,
    observedAt: timestamp.nullable(),
    ingestedAt: timestamp.nullable(),
    revision: z.number().int().positive().nullable(),
    lineageId: uuid.nullable(),
    observationId: uuid.nullable(),
    workflow: z
      .enum([
        'raw',
        'automatically_validated',
        'expert_validated',
        'corrected',
        'estimated',
        'rejected',
        'synthetic_scenario',
      ])
      .nullable(),
    qualityReason: z.string().nullable(),
    uncertainty: decimal.nullable(),
    uncertaintyMethod: z.string().nullable(),
    measurementMethod: z.string().nullable(),
    calibrationRef: z.string().nullable(),
    ratingCurveRef: z.string().nullable(),
    source: sourceSchema,
  })
  .strict()
  .superRefine((v, ctx) => {
    const expected = { stage: 'm', discharge: 'm3/s', accumulated_volume: 'm3' } as const;
    if (v.unit !== expected[v.kind])
      ctx.addIssue({
        code: 'custom',
        path: ['unit'],
        message: 'quantity kind and unit must agree',
      });
    if (
      v.dataState === 'no_data' &&
      (v.value !== null ||
        v.observedAt !== null ||
        v.ingestedAt !== null ||
        v.revision !== null ||
        v.lineageId !== null ||
        v.observationId !== null ||
        v.workflow !== null ||
        v.quality !== 'unknown')
    )
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'no-data is never zero or timestamped',
      });
    if (
      v.dataState === 'reported' &&
      (v.value === null ||
        v.observedAt === null ||
        v.ingestedAt === null ||
        v.revision === null ||
        v.quality !== 'valid')
    )
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'reported quantity requires value and revision provenance',
      });
    if (
      v.source.kind === 'canonical_observation' &&
      (v.lineageId === null ||
        v.observationId === null ||
        v.revision === null ||
        v.workflow === null)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['source'],
        message: 'canonical observations require lineage and revision identity',
      });
    if (
      v.source.kind === 'synthetic_scenario' &&
      (v.lineageId !== null ||
        v.observationId !== null ||
        (v.value !== null && v.workflow !== 'synthetic_scenario'))
    )
      ctx.addIssue({
        code: 'custom',
        path: ['source'],
        message: 'synthetic scenario values cannot claim canonical observation identity',
      });
  });
const measured = (unit: 'V' | 'dBm') =>
  z.union([
    z.object({ state: z.literal('unknown') }).strict(),
    z.object({ state: z.literal('measured'), value: decimal, unit: z.literal(unit) }).strict(),
  ]);
const healthSchema = z
  .object({
    connection,
    fault,
    faultCode: z.string().nullable(),
    dataCondition: z.enum(['current', 'stale', 'unreliable', 'unknown', 'no_data', 'unconfigured']),
    freshness: z.literal('unconfigured'),
    lastSeenReceivedAt: timestamp.nullable(),
    lastObservedAt: timestamp.nullable(),
    ageMicroseconds: z.string().regex(/^\d+$/).nullable(),
    power: measured('V'),
    signal: measured('dBm'),
    source: sourceSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.lastSeenReceivedAt === null) !== (value.ageMicroseconds === null))
      context.addIssue({
        code: 'custom',
        path: ['ageMicroseconds'],
        message: 'data age and last-seen receipt must be present together',
      });
  });
export const liveOperationsRowSchema = z
  .object({
    deviceId: uuid,
    stationId: uuid,
    territory: z.object({ id: uuid, name: z.string(), code: z.string() }).strict(),
    waterway: z
      .object({
        id: uuid.nullable(),
        name: z.string().nullable(),
        sectionId: uuid.nullable(),
        sectionName: z.string().nullable(),
      })
      .strict(),
    station: z.object({ code: z.string(), name: z.string() }).strict(),
    device: z
      .object({
        code: z.string(),
        name: z.string(),
        protocol: z.string(),
        installationId: uuid,
        installationProvenance: z.string(),
      })
      .strict(),
    quantities: z
      .object({
        stage: quantitySchema,
        discharge: quantitySchema,
        accumulatedCounter: quantitySchema,
      })
      .strict(),
    health: healthSchema,
    governed: z
      .object({
        plan: z
          .object({
            state: z.literal('unconfigured'),
            source: z.literal('unconfigured'),
            reason: z.string(),
          })
          .strict(),
        intervalVariance: z
          .object({
            state: z.literal('unconfigured'),
            source: z.literal('unconfigured'),
            reason: z.string(),
          })
          .strict(),
        waterStatus: z
          .object({
            state: z.literal('unconfigured'),
            source: z.literal('unconfigured'),
            reason: z.string(),
          })
          .strict(),
        calibrationDue: z
          .object({
            state: z.literal('unconfigured'),
            source: z.literal('unconfigured'),
            reason: z.string(),
          })
          .strict(),
        alarm: z
          .object({
            state: z.literal('unconfigured'),
            source: z.literal('unconfigured'),
            reason: z.string(),
          })
          .strict(),
        incident: z
          .object({
            state: z.literal('unconfigured'),
            source: z.literal('unconfigured'),
            reason: z.string(),
          })
          .strict(),
      })
      .strict(),
    attention: z
      .object({ state: attention, label: z.string(), icon: z.string(), value: z.string() })
      .strict(),
    synthetic: z.literal(true),
    provenance: z.string().min(1),
  })
  .strict();
export type LiveOperationsRow = z.infer<typeof liveOperationsRowSchema>;
const hierarchyFacet = z
  .object({
    id: uuid,
    code: z.string(),
    name: z.string(),
    depth: z.number().int().nonnegative(),
    path: z.array(uuid),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.path.length !== value.depth + 1 || value.path.at(-1) !== value.id)
      context.addIssue({
        code: 'custom',
        path: ['path'],
        message: 'territory path and depth must identify the facet hierarchy',
      });
  });
export const liveOperationsResponseSchema = z
  .object({
    referenceAt: timestamp,
    knownAt: timestamp,
    presentationTimeZone: z.literal('Asia/Tashkent'),
    scenario: z
      .object({
        id: uuid,
        version: z.number().int().positive(),
        provenance: z.string(),
        dataClassification: z.literal('synthetic'),
        officialTelemetry: z.literal(false),
      })
      .strict(),
    scope: z
      .object({
        stationDenominator: z.number().int().nonnegative(),
        deviceDenominator: z.number().int().nonnegative(),
      })
      .strict(),
    facets: z
      .object({
        territories: z.array(hierarchyFacet),
        waterways: z.array(
          z.object({ id: uuid, code: z.string().nullable(), name: z.string().nullable() }).strict(),
        ),
        sections: z.array(
          z.object({ id: uuid, code: z.string().nullable(), name: z.string().nullable() }).strict(),
        ),
        stations: z.array(z.object({ id: uuid, code: z.string(), name: z.string() }).strict()),
        devices: z.array(z.object({ id: uuid, code: z.string(), name: z.string() }).strict()),
        measurementKinds: z.array(kind),
        connections: z.array(connection),
        faults: z.array(fault),
        dataStates: z.array(dataState),
        qualities: z.array(quality),
        attentions: z.array(attention),
      })
      .strict(),
    rows: z.array(liveOperationsRowSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type LiveOperationsResponse = z.infer<typeof liveOperationsResponseSchema>;

export const liveOperationsInspectorSchema = z
  .object({
    referenceAt: timestamp,
    knownAt: timestamp,
    current: liveOperationsRowSchema,
    trend: z
      .array(
        z
          .object({
            at: timestamp,
            kind,
            raw: decimal.nullable(),
            validated: decimal.nullable(),
            unit: z.enum(['m', 'm3/s', 'm3']),
            gap: z.boolean(),
            source: sourceSchema,
          })
          .strict()
          .superRefine((value, context) => {
            const expected = {
              stage: 'm',
              discharge: 'm3/s',
              accumulated_volume: 'm3',
            } as const;
            if (value.unit !== expected[value.kind])
              context.addIssue({
                code: 'custom',
                path: ['unit'],
                message: 'trend kind and unit must agree',
              });
            if (
              (value.gap && (value.raw !== null || value.validated !== null)) ||
              (!value.gap && value.raw === null)
            )
              context.addIssue({
                code: 'custom',
                path: ['gap'],
                message:
                  'trend gaps cannot contain values and reported points require raw evidence',
              });
          }),
      )
      .max(250),
    revisions: z
      .array(
        z
          .object({
            observationId: uuid.nullable(),
            lineageId: uuid.nullable(),
            revision: z.number().int().positive(),
            workflow: z.string(),
            quality,
            value: decimal,
            unit: z.enum(['m', 'm3/s', 'm3']),
            observedAt: timestamp,
            ingestedAt: timestamp,
            reason: z.string().nullable(),
            source: sourceSchema,
          })
          .strict()
          .superRefine((value, context) => {
            const hasIdentity = value.observationId !== null && value.lineageId !== null;
            if (value.source.kind === 'canonical_observation' && !hasIdentity)
              context.addIssue({
                code: 'custom',
                path: ['source'],
                message: 'canonical revision history requires observation and lineage identity',
              });
            if (value.source.kind === 'synthetic_scenario' && hasIdentity)
              context.addIssue({
                code: 'custom',
                path: ['source'],
                message: 'synthetic revision history cannot claim canonical identity',
              });
          }),
      )
      .max(25),
    healthHistory: z
      .object({
        state: z.literal('unconfigured'),
        source: z.literal('unconfigured'),
        reason: z.string(),
      })
      .strict(),
    placeholders: z
      .object({
        plan: z.literal('unconfigured'),
        intervalVariance: z.literal('unconfigured'),
        alarms: z.literal('unconfigured'),
        incidents: z.literal('unconfigured'),
        maintenance: z.literal('unconfigured'),
        firmware: z.literal('unconfigured'),
        documents: z.literal('unconfigured'),
      })
      .strict(),
  })
  .strict();
export type LiveOperationsInspector = z.infer<typeof liveOperationsInspectorSchema>;
