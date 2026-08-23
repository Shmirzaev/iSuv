import { z } from 'zod';

const utcTimestampSchema = z.string().datetime({ offset: true });
export const networkEntityTypeSchema = z.enum([
  'region',
  'basin',
  'waterway',
  'junction',
  'section',
  'control_structure',
  'station',
  'device',
  'sensor',
]);
export type NetworkEntityType = z.infer<typeof networkEntityTypeSchema>;

export const networkLifecycleSchema = z.enum(['planned', 'active', 'retired']);
export const networkStatusSchema = z.enum([
  'operational',
  'maintenance',
  'decommissioned',
  'unknown',
]);
export const dataClassificationSchema = z.enum(['synthetic', 'official']);

const pointGeometrySchema = z.object({
  type: z.literal('Point'),
  coordinates: z.tuple([z.number().gte(-180).lte(180), z.number().gte(-90).lte(90)]),
});
const lineStringGeometrySchema = z.object({
  type: z.literal('LineString'),
  coordinates: z
    .array(z.tuple([z.number().gte(-180).lte(180), z.number().gte(-90).lte(90)]))
    .min(2),
});
const multiPolygonGeometrySchema = z.object({
  type: z.literal('MultiPolygon'),
  coordinates: z
    .array(
      z
        .array(
          z.array(z.tuple([z.number().gte(-180).lte(180), z.number().gte(-90).lte(90)])).min(4),
        )
        .min(1),
    )
    .min(1),
});
export type NetworkGeometry =
  | z.infer<typeof pointGeometrySchema>
  | z.infer<typeof lineStringGeometrySchema>
  | z.infer<typeof multiPolygonGeometrySchema>;

const baseEntitySchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  territoryId: z.uuid(),
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(256),
  lifecycle: networkLifecycleSchema,
  status: networkStatusSchema,
  dataClassification: dataClassificationSchema,
  revision: z.number().int().positive(),
  createdAt: utcTimestampSchema,
  updatedAt: utcTimestampSchema,
});

const networkEntityBaseSchema = z.discriminatedUnion('type', [
  baseEntitySchema.extend({
    type: z.literal('region'),
    geometry: multiPolygonGeometrySchema.nullable(),
  }),
  baseEntitySchema.extend({
    type: z.literal('basin'),
    regionId: z.uuid().nullable(),
    geometry: multiPolygonGeometrySchema.nullable(),
  }),
  baseEntitySchema.extend({
    type: z.literal('waterway'),
    basinId: z.uuid().nullable(),
    geometry: lineStringGeometrySchema.nullable(),
  }),
  baseEntitySchema.extend({
    type: z.literal('junction'),
    geometry: pointGeometrySchema.nullable(),
  }),
  baseEntitySchema.extend({
    type: z.literal('section'),
    waterwayId: z.uuid().nullable(),
    upstreamJunctionId: z.uuid().nullable(),
    downstreamJunctionId: z.uuid().nullable(),
    upstreamBoundary: z.boolean(),
    downstreamBoundary: z.boolean(),
    geometry: lineStringGeometrySchema.nullable(),
  }),
  baseEntitySchema.extend({
    type: z.literal('control_structure'),
    sectionId: z.uuid().nullable(),
    junctionId: z.uuid().nullable(),
    kind: z.enum(['weir', 'gate', 'sluice', 'pump', 'check_dam', 'other']),
    monitoringOnly: z.literal(true),
    geometry: pointGeometrySchema.nullable(),
  }),
  baseEntitySchema.extend({
    type: z.literal('station'),
    sectionId: z.uuid().nullable(),
    junctionId: z.uuid().nullable(),
    controlStructureId: z.uuid().nullable(),
    geometry: pointGeometrySchema.nullable(),
  }),
  baseEntitySchema.extend({
    type: z.literal('device'),
    stationId: z.uuid().nullable(),
    installationProvenance: z.string().min(1).nullable(),
    protocol: z.enum(['mqtt', 'opc_ua', 'modbus', 'scada', 'manual']),
    geometry: z.null(),
  }),
  baseEntitySchema.extend({
    type: z.literal('sensor'),
    deviceId: z.uuid(),
    measurementKind: z.enum(['stage', 'discharge', 'accumulated_volume']),
    unit: z.enum(['m', 'm3/s', 'm3']),
    geometry: z.null(),
  }),
]);
export const networkEntitySchema = networkEntityBaseSchema.superRefine((entity, context) => {
  if (entity.type === 'section') {
    if (entity.upstreamBoundary !== (entity.upstreamJunctionId === null)) {
      context.addIssue({
        code: 'custom',
        path: ['upstreamBoundary'],
        message: 'A hidden upstream endpoint must be marked as a territory boundary.',
      });
    }
    if (entity.downstreamBoundary !== (entity.downstreamJunctionId === null)) {
      context.addIssue({
        code: 'custom',
        path: ['downstreamBoundary'],
        message: 'A hidden downstream endpoint must be marked as a territory boundary.',
      });
    }
  }
  if (entity.type !== 'sensor') return;
  const requiredUnit =
    entity.measurementKind === 'stage'
      ? 'm'
      : entity.measurementKind === 'discharge'
        ? 'm3/s'
        : 'm3';
  if (entity.unit !== requiredUnit) {
    context.addIssue({
      code: 'custom',
      path: ['unit'],
      message: `${entity.measurementKind} sensors require ${requiredUnit}.`,
    });
  }
});
export type NetworkEntity = z.infer<typeof networkEntitySchema>;

export const networkTopologyEdgeSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  territoryId: z.uuid(),
  sectionId: z.uuid(),
  upstreamJunctionId: z.uuid().nullable(),
  downstreamJunctionId: z.uuid().nullable(),
  upstreamBoundary: z.boolean(),
  downstreamBoundary: z.boolean(),
  dataClassification: dataClassificationSchema,
  createdAt: utcTimestampSchema,
  updatedAt: utcTimestampSchema,
});
export type NetworkTopologyEdge = z.infer<typeof networkTopologyEdgeSchema>;

export const networkEntitiesResponseSchema = z.object({ entities: z.array(networkEntitySchema) });
export const networkEntityResponseSchema = z.object({ entity: networkEntitySchema });
export const networkTopologyResponseSchema = z.object({
  edges: z.array(networkTopologyEdgeSchema),
});
