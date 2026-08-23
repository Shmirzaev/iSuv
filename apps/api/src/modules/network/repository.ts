import {
  networkEntitySchema,
  networkTopologyEdgeSchema,
  type NetworkEntity,
  type NetworkEntityType,
  type NetworkTopologyEdge,
} from '@isuv/contracts';
import { withDatabase } from '../../db/client.js';

export interface NetworkReadRepository {
  listEntities(type: NetworkEntityType, territoryId: string): Promise<NetworkEntity[]>;
  findEntity(type: NetworkEntityType, id: string): Promise<NetworkEntity | null>;
  listTopology(territoryId: string): Promise<NetworkTopologyEdge[]>;
}

interface EntityRow {
  id: string;
  organization_id: string;
  territory_id: string;
  code: string;
  name: string;
  lifecycle: NetworkEntity['lifecycle'];
  status: NetworkEntity['status'];
  data_classification: NetworkEntity['dataClassification'];
  revision: number;
  geometry: NetworkEntity['geometry'];
  created_at: Date;
  updated_at: Date;
  region_id?: string | null;
  basin_id?: string | null;
  waterway_id?: string | null;
  waterway_territory_id?: string | null;
  upstream_junction_id?: string;
  downstream_junction_id?: string;
  upstream_territory_id?: string;
  downstream_territory_id?: string;
  section_id?: string | null;
  junction_id?: string | null;
  control_structure_id?: string | null;
  kind?: 'weir' | 'gate' | 'sluice' | 'pump' | 'check_dam' | 'other';
  station_id?: string | null;
  installation_provenance?: string | null;
  protocol?: 'mqtt' | 'opc_ua' | 'modbus' | 'scada' | 'manual';
  device_id?: string;
  measurement_kind?: 'stage' | 'discharge' | 'accumulated_volume';
  unit?: 'm' | 'm3/s' | 'm3';
}

const commonSelect = `
  id, organization_id, territory_id, code, name, lifecycle, status,
  data_classification, revision, ST_AsGeoJSON(geometry)::json AS geometry,
  created_at, updated_at`;

const sectionSelect = `
  section.id, section.organization_id, section.territory_id, section.code, section.name,
  section.lifecycle, section.status, section.data_classification, section.revision,
  ST_AsGeoJSON(section.geometry)::json AS geometry, section.created_at, section.updated_at,
  section.waterway_id, waterway.territory_id AS waterway_territory_id,
  section.upstream_junction_id, section.downstream_junction_id,
  upstream.territory_id AS upstream_territory_id,
  downstream.territory_id AS downstream_territory_id`;

const entityQueries: Record<NetworkEntityType, string> = {
  region: `SELECT ${commonSelect} FROM water_regions`,
  basin: `SELECT ${commonSelect}, region_id FROM water_basins`,
  waterway: `SELECT ${commonSelect}, basin_id FROM waterways`,
  junction: `SELECT ${commonSelect} FROM network_junctions`,
  section: `SELECT ${sectionSelect}
            FROM water_sections section
            LEFT JOIN waterways waterway ON waterway.id = section.waterway_id
            JOIN network_junctions upstream ON upstream.id = section.upstream_junction_id
            JOIN network_junctions downstream ON downstream.id = section.downstream_junction_id`,
  control_structure: `SELECT ${commonSelect}, section_id, junction_id, kind FROM control_structures`,
  station: `SELECT ${commonSelect}, section_id, junction_id, control_structure_id FROM monitoring_stations`,
  device: `SELECT d.id, d.organization_id, d.territory_id, d.code, d.name, d.lifecycle, d.status,
                   d.data_classification, d.revision, NULL::json AS geometry, d.created_at, d.updated_at,
                   installation.station_id, installation.provenance AS installation_provenance, d.protocol
            FROM telemetry_devices d
            LEFT JOIN LATERAL (
              SELECT station_id, provenance
              FROM telemetry_device_installations
              WHERE device_id = d.id AND effective_from <= now()
                AND (effective_until IS NULL OR effective_until > now())
              ORDER BY effective_from DESC, id DESC
              LIMIT 1
            ) installation ON true`,
  sensor: `SELECT id, organization_id, territory_id, code, name, lifecycle, status,
                  data_classification, revision, NULL::json AS geometry, created_at, updated_at,
                  device_id, measurement_kind, unit
           FROM telemetry_sensors`,
};

function entityColumn(type: NetworkEntityType, column: 'id' | 'territory_id'): string {
  return type === 'section' ? `section.${column}` : column;
}

function utc(value: Date): string {
  return value.toISOString();
}

function toEntity(type: NetworkEntityType, row: EntityRow): NetworkEntity {
  const base = {
    type,
    id: row.id,
    organizationId: row.organization_id,
    territoryId: row.territory_id,
    code: row.code,
    name: row.name,
    lifecycle: row.lifecycle,
    status: row.status,
    dataClassification: row.data_classification,
    revision: row.revision,
    geometry: row.geometry,
    createdAt: utc(row.created_at),
    updatedAt: utc(row.updated_at),
  };
  switch (type) {
    case 'basin':
      return networkEntitySchema.parse({ ...base, regionId: row.region_id ?? null });
    case 'waterway':
      return networkEntitySchema.parse({ ...base, basinId: row.basin_id ?? null });
    case 'section':
      return networkEntitySchema.parse({
        ...base,
        waterwayId:
          row.waterway_territory_id === row.territory_id ? (row.waterway_id ?? null) : null,
        upstreamJunctionId:
          row.upstream_territory_id === row.territory_id ? row.upstream_junction_id : null,
        downstreamJunctionId:
          row.downstream_territory_id === row.territory_id ? row.downstream_junction_id : null,
        upstreamBoundary: row.upstream_territory_id !== row.territory_id,
        downstreamBoundary: row.downstream_territory_id !== row.territory_id,
      });
    case 'control_structure':
      return networkEntitySchema.parse({
        ...base,
        sectionId: row.section_id ?? null,
        junctionId: row.junction_id ?? null,
        kind: row.kind,
        monitoringOnly: true,
      });
    case 'station':
      return networkEntitySchema.parse({
        ...base,
        sectionId: row.section_id ?? null,
        junctionId: row.junction_id ?? null,
        controlStructureId: row.control_structure_id ?? null,
      });
    case 'device':
      return networkEntitySchema.parse({
        ...base,
        stationId: row.station_id ?? null,
        installationProvenance: row.installation_provenance ?? null,
        protocol: row.protocol,
      });
    case 'sensor':
      return networkEntitySchema.parse({
        ...base,
        deviceId: row.device_id,
        measurementKind: row.measurement_kind,
        unit: row.unit,
      });
    default:
      return networkEntitySchema.parse(base);
  }
}

export class PostgresNetworkReadRepository implements NetworkReadRepository {
  public constructor(private readonly databaseUrl: string | undefined) {}

  public async listEntities(
    type: NetworkEntityType,
    territoryId: string,
  ): Promise<NetworkEntity[]> {
    return withDatabase(this.databaseUrl, async (pool) => {
      const result = await pool.query<EntityRow>(
        `${entityQueries[type]} WHERE ${entityColumn(type, 'territory_id')} = $1 ORDER BY ${entityColumn(type, 'id')}`,
        [territoryId],
      );
      return result.rows.map((row) => toEntity(type, row));
    });
  }

  public async findEntity(type: NetworkEntityType, id: string): Promise<NetworkEntity | null> {
    return withDatabase(this.databaseUrl, async (pool) => {
      const result = await pool.query<EntityRow>(
        `${entityQueries[type]} WHERE ${entityColumn(type, 'id')} = $1`,
        [id],
      );
      const row = result.rows[0];
      return row ? toEntity(type, row) : null;
    });
  }

  public async listTopology(territoryId: string): Promise<NetworkTopologyEdge[]> {
    return withDatabase(this.databaseUrl, async (pool) => {
      const result = await pool.query<{
        id: string;
        organization_id: string;
        territory_id: string;
        upstream_junction_id: string;
        downstream_junction_id: string;
        data_classification: NetworkTopologyEdge['dataClassification'];
        created_at: Date;
        updated_at: Date;
        upstream_territory_id: string;
        downstream_territory_id: string;
      }>(
        `SELECT section.id, section.organization_id, section.territory_id,
                section.upstream_junction_id, section.downstream_junction_id,
                section.data_classification, section.created_at, section.updated_at,
                upstream.territory_id AS upstream_territory_id,
                downstream.territory_id AS downstream_territory_id
         FROM water_sections section
         JOIN network_junctions upstream ON upstream.id = section.upstream_junction_id
         JOIN network_junctions downstream ON downstream.id = section.downstream_junction_id
         WHERE section.territory_id = $1
         ORDER BY section.created_at, section.id`,
        [territoryId],
      );
      return result.rows.map((row) =>
        networkTopologyEdgeSchema.parse({
          id: row.id,
          organizationId: row.organization_id,
          territoryId: row.territory_id,
          sectionId: row.id,
          upstreamJunctionId:
            row.upstream_territory_id === territoryId ? row.upstream_junction_id : null,
          downstreamJunctionId:
            row.downstream_territory_id === territoryId ? row.downstream_junction_id : null,
          upstreamBoundary: row.upstream_territory_id !== territoryId,
          downstreamBoundary: row.downstream_territory_id !== territoryId,
          dataClassification: row.data_classification,
          createdAt: utc(row.created_at),
          updatedAt: utc(row.updated_at),
        }),
      );
    });
  }
}
