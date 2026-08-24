import { z } from 'zod';

const uuid = z.uuid();
const timestamp = z.string().datetime({ offset: true });
const state = z.enum(['reported', 'unreliable', 'no_data']);
const source = z
  .object({
    kind: z.literal('synthetic_scenario'),
    label: z.string().min(1),
    provenance: z.string().min(1),
    official: z.literal(false),
  })
  .strict();
const point = z
  .object({
    type: z.literal('Point'),
    coordinates: z.tuple([z.number().gte(-180).lte(180), z.number().gte(-90).lte(90)]),
  })
  .strict();
const line = z
  .object({
    type: z.literal('LineString'),
    coordinates: z
      .array(z.tuple([z.number().gte(-180).lte(180), z.number().gte(-90).lte(90)]))
      .min(2),
  })
  .strict();
const multiLine = z
  .object({
    type: z.literal('MultiLineString'),
    coordinates: z
      .array(z.array(z.tuple([z.number().gte(-180).lte(180), z.number().gte(-90).lte(90)])).min(2))
      .min(1),
  })
  .strict();
const unconfigured = z
  .object({
    state: z.literal('unconfigured'),
    source: z.literal('unconfigured'),
    reason: z.string().min(1),
  })
  .strict();

function quantity(unit: 'm' | 'm3/s' | 'm3') {
  return z
    .object({
      value: z.string().nullable(),
      unit: z.literal(unit),
      state,
      observedAt: timestamp.nullable(),
      ingestedAt: timestamp.nullable(),
      source,
    })
    .strict()
    .superRefine((value, ctx) => {
      const noData = value.state === 'no_data';
      if (noData !== (value.value === null))
        ctx.addIssue({ code: 'custom', message: 'no_data quantities must have a null value.' });
      if ((value.observedAt === null) !== (value.ingestedAt === null))
        ctx.addIssue({
          code: 'custom',
          message: 'observation and ingestion times must occur together.',
        });
    });
}

export const mapNetworkQuerySchema = z
  .object({
    territoryId: uuid.optional(),
    detail: z.enum(['overview', 'basin', 'network']).default('overview'),
    stationId: uuid.optional(),
  })
  .strict();
export type MapNetworkQuery = z.infer<typeof mapNetworkQuerySchema>;

export const traceQuerySchema = z
  .object({
    territoryId: uuid.optional(),
    stationId: uuid,
    direction: z.enum(['upstream', 'downstream']).default('upstream'),
  })
  .strict();
export type TraceQuery = z.infer<typeof traceQuerySchema>;

export const playbackQuerySchema = z
  .object({ territoryId: uuid.optional(), stationId: uuid })
  .strict();
export type PlaybackQuery = z.infer<typeof playbackQuerySchema>;

export const mapNetworkResponseSchema = z
  .object({
    referenceAt: timestamp,
    knownAt: timestamp,
    scenario: source,
    detail: z.enum(['overview', 'basin', 'network']),
    scope: z
      .object({
        stationCount: z.number().int().nonnegative(),
        deviceCount: z.number().int().nonnegative(),
      })
      .strict(),
    overview: z.array(
      z
        .object({
          basinId: uuid,
          basinName: z.string().min(1),
          stationCount: z.number().int().nonnegative(),
          states: z.record(state, z.number().int().nonnegative()),
        })
        .strict(),
    ),
    layers: z
      .object({
        waterways: z.array(z.object({ id: uuid, geometry: z.union([line, multiLine]) }).strict()),
        junctions: z.array(z.object({ id: uuid, geometry: point }).strict()),
        sections: z.array(
          z
            .object({
              id: uuid,
              upstreamJunctionId: uuid.nullable(),
              downstreamJunctionId: uuid.nullable(),
              boundary: z.boolean(),
              geometry: line,
            })
            .strict(),
        ),
        stations: z.array(
          z.object({ id: uuid, junctionId: uuid, deviceId: uuid, geometry: point }).strict(),
        ),
      })
      .strict(),
    panel: z
      .object({
        stationId: uuid,
        responsibleTerritory: z
          .object({ id: uuid, code: z.string().min(1), name: z.string().min(1) })
          .strict(),
        stage: quantity('m'),
        discharge: quantity('m3/s'),
        counter: quantity('m3'),
        health: z
          .object({
            connection: z.enum(['communicating', 'offline', 'unknown']),
            fault: z.enum(['reported', 'none', 'unknown']),
            dataCondition: z.enum(['current', 'stale', 'unreliable', 'unknown', 'no_data']),
            lastSeenReceivedAt: timestamp.nullable(),
            lastObservedAt: timestamp.nullable(),
            power: z.object({ value: z.string().nullable(), unit: z.literal('V') }).strict(),
            signal: z.object({ value: z.string().nullable(), unit: z.literal('dBm') }).strict(),
            source,
          })
          .strict(),
        targetDischarge: unconfigured,
        deliveredVolume: unconfigured,
        plannedVolume: unconfigured,
        variance: unconfigured,
        duration: unconfigured,
        confidence: unconfigured,
        balance: unconfigured,
      })
      .strict()
      .nullable(),
  })
  .strict();
export type MapNetworkResponse = z.infer<typeof mapNetworkResponseSchema>;

export const traceResponseSchema = z
  .object({
    stationId: uuid,
    direction: z.enum(['upstream', 'downstream']),
    nodes: z.array(uuid).max(250),
    edges: z
      .array(
        z
          .object({
            sectionId: uuid,
            from: uuid.nullable(),
            to: uuid.nullable(),
            boundary: z.boolean(),
          })
          .strict(),
      )
      .max(250),
    truncated: z.boolean(),
    disclaimer: z.string().min(1),
  })
  .strict();
export type TraceResponse = z.infer<typeof traceResponseSchema>;

export const playbackResponseSchema = z
  .object({
    stationId: uuid,
    unit: z.literal('m'),
    referenceAt: timestamp,
    knownAt: timestamp,
    paused: z.literal(true),
    frames: z
      .array(
        z
          .object({
            at: timestamp,
            raw: z.string().nullable(),
            validated: z.string().nullable(),
            gap: z.boolean(),
            source,
          })
          .strict()
          .superRefine((value, ctx) => {
            if (value.gap && (value.raw !== null || value.validated !== null))
              ctx.addIssue({ code: 'custom', message: 'A gap has no interpolated values.' });
          }),
      )
      .length(24),
    disclaimer: z.string().min(1),
  })
  .strict();
export type PlaybackResponse = z.infer<typeof playbackResponseSchema>;
