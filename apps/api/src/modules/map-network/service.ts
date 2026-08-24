import type {
  MapNetworkQuery,
  MapNetworkResponse,
  PlaybackResponse,
  TraceResponse,
} from '@isuv/contracts';
import { boundedDirectedTrace } from '@isuv/domain';
import { withDatabase } from '../../db/client.js';

const scenarioId = 'd6000000-0000-4000-8000-000000000001';
const traceCap = 250;
const utc = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

type Client = { query: <Row>(sql: string, values?: unknown[]) => Promise<{ rows: Row[] }> };
type DataState = 'reported' | 'unreliable' | 'no_data';
type Connection = 'communicating' | 'offline' | 'unknown';
type Fault = 'reported' | 'none' | 'unknown';
type DataCondition = 'current' | 'stale' | 'unreliable' | 'unknown' | 'no_data';
type Point = { type: 'Point'; coordinates: [number, number] };
type Line = { type: 'LineString'; coordinates: [number, number][] };
type MultiLine = { type: 'MultiLineString'; coordinates: [number, number][][] };

interface ScenarioRow {
  reference_at: string;
  known_at: string;
  provenance: string;
  organization_id: string;
}
interface ScopeRow {
  station_count: number;
  device_count: number;
}
interface OverviewRow {
  basin_id: string;
  basin_name: string;
  station_count: number;
  reported: number;
  unreliable: number;
  no_data: number;
}
interface WaterwayRow {
  id: string;
  geometry: Line | MultiLine;
}
interface JunctionRow {
  id: string;
  geometry: Point;
}
interface SectionRow {
  id: string;
  upstream_junction_id: string;
  downstream_junction_id: string;
  upstream_scoped: boolean;
  downstream_scoped: boolean;
  geometry: Line;
}
interface StationRow {
  id: string;
  junction_id: string;
  device_id: string;
  geometry: Point;
}
interface PanelRow {
  station_id: string;
  territory_id: string;
  territory_code: string;
  territory_name: string;
  stage_m: string | null;
  discharge_m3s: string | null;
  counter_m3: string | null;
  stage_data_state: DataState;
  discharge_data_state: DataState;
  counter_data_state: DataState;
  observed_at: string | null;
  ingested_at: string | null;
  last_seen_received_at: string | null;
  connection_status: Connection;
  device_fault: Fault;
  power_voltage: string | null;
  signal_strength_dbm: string | null;
  provenance: string;
}
interface TraceStartRow {
  junction_id: string;
}
interface PlaybackRow {
  at: string;
  raw: string | null;
  validated: string | null;
  gap: boolean;
  reference_at: string;
  known_at: string;
  provenance: string;
}

const descendants = `
  WITH RECURSIVE scope AS (
    SELECT id FROM territories WHERE id = $1
    UNION ALL
    SELECT child.id FROM territories child JOIN scope parent ON child.parent_territory_id = parent.id
  )`;

function source(provenance: string) {
  return {
    kind: 'synthetic_scenario' as const,
    label: 'Synthetic P5-004 map and topology scenario; not official telemetry.',
    provenance,
    official: false as const,
  };
}

const noGovernedSource = {
  state: 'unconfigured' as const,
  source: 'unconfigured' as const,
  reason: 'No governed source is configured for this field.',
};

function condition(state: DataState): DataCondition {
  if (state === 'no_data') return 'no_data';
  if (state === 'unreliable') return 'unreliable';
  return 'current';
}

export class PostgresMapNetworkService {
  public constructor(private readonly databaseUrl?: string) {}

  private async read<T>(action: (client: Client) => Promise<T>): Promise<T> {
    return withDatabase(this.databaseUrl, async (pool) => {
      const client = await pool.connect();
      try {
        return await action(client);
      } finally {
        client.release();
      }
    });
  }

  public async findDefaultTerritory(
    userId: string,
    organizationId: string,
    evaluatedAt: Date,
  ): Promise<string | null> {
    return this.read(async (client) => {
      const result = await client.query<{ id: string }>(
        `SELECT COALESCE(
           (
              SELECT role_grant.territory_id
              FROM user_role_grants role_grant
              WHERE role_grant.user_id = $1
                AND role_grant.organization_id = $2
                AND role_grant.territory_id IS NOT NULL
                AND role_grant.cancelled_at IS NULL
                AND role_grant.effective_from <= $3
                AND (role_grant.effective_until IS NULL OR role_grant.effective_until > $3)
              ORDER BY role_grant.effective_from, role_grant.id
             LIMIT 1
           ),
           (
             SELECT scenario.territory_id
             FROM live_operations_synthetic_scenarios scenario
             WHERE scenario.id = $4 AND scenario.organization_id = $2
           )
         ) AS id`,
        [userId, organizationId, evaluatedAt, scenarioId],
      );
      return result.rows[0]?.id ?? null;
    });
  }

  private async scenario(client: Client, territoryId: string): Promise<ScenarioRow | null> {
    const result = await client.query<ScenarioRow>(
      `${descendants}
       SELECT ${utc('scenario.reference_at')} AS reference_at,
              ${utc('scenario.known_at')} AS known_at,
              scenario.provenance,
              scenario.organization_id
       FROM live_operations_synthetic_scenarios scenario
       WHERE scenario.id = $2
         AND EXISTS (
           SELECT 1 FROM live_operations_synthetic_rows row
           WHERE row.scenario_id = scenario.id AND row.territory_id IN (SELECT id FROM scope)
         )`,
      [territoryId, scenarioId],
    );
    return result.rows[0] ?? null;
  }

  public async map(
    territoryId: string,
    query: Pick<MapNetworkQuery, 'detail' | 'stationId'>,
  ): Promise<MapNetworkResponse | null> {
    return this.read(async (client) => {
      const scenario = await this.scenario(client, territoryId);
      if (!scenario) return null;

      const scopeResult = await client.query<ScopeRow>(
        `${descendants}
         SELECT count(*)::int AS station_count, count(DISTINCT row.device_id)::int AS device_count
         FROM live_operations_synthetic_rows row
         WHERE row.scenario_id = $2 AND row.territory_id IN (SELECT id FROM scope)`,
        [territoryId, scenarioId],
      );
      const scope = scopeResult.rows[0]!;
      const overviewRows = await client.query<OverviewRow>(
        `${descendants}
         SELECT basin.id AS basin_id, basin.name AS basin_name,
           count(*)::int AS station_count,
           count(*) FILTER (WHERE row.data_state = 'reported')::int AS reported,
           count(*) FILTER (WHERE row.data_state = 'unreliable')::int AS unreliable,
           count(*) FILTER (WHERE row.data_state = 'no_data')::int AS no_data
         FROM live_operations_synthetic_rows row
         JOIN monitoring_stations station ON station.id = row.station_id
         JOIN LATERAL (
           SELECT candidate.*
           FROM water_sections candidate
           WHERE candidate.upstream_junction_id = station.junction_id
           ORDER BY candidate.id
           LIMIT 1
         ) section ON true
         JOIN waterways waterway ON waterway.id = section.waterway_id
         JOIN water_basins basin ON basin.id = waterway.basin_id
         WHERE row.scenario_id = $2 AND row.territory_id IN (SELECT id FROM scope)
         GROUP BY basin.id, basin.name
         ORDER BY basin.name, basin.id`,
        [territoryId, scenarioId],
      );

      const layers = {
        waterways: [] as { id: string; geometry: Line | MultiLine }[],
        junctions: [] as { id: string; geometry: Point }[],
        sections: [] as {
          id: string;
          upstreamJunctionId: string | null;
          downstreamJunctionId: string | null;
          boundary: boolean;
          geometry: Line;
        }[],
        stations: [] as { id: string; junctionId: string; deviceId: string; geometry: Point }[],
      };

      if (query.detail === 'basin' || query.detail === 'network') {
        const waterways = await client.query<WaterwayRow>(
          `${descendants},
           scoped_section_geometries AS (
             SELECT section.id, section.waterway_id,
                    CASE
                      WHEN upstream.territory_id IN (SELECT id FROM scope)
                       AND downstream.territory_id IN (SELECT id FROM scope)
                        THEN section.geometry
                      WHEN upstream.territory_id IN (SELECT id FROM scope)
                        THEN ST_MakeLine(upstream.geometry, upstream.geometry)
                      ELSE ST_MakeLine(downstream.geometry, downstream.geometry)
                    END AS geometry
             FROM water_sections section
             JOIN network_junctions upstream ON upstream.id = section.upstream_junction_id
             JOIN network_junctions downstream ON downstream.id = section.downstream_junction_id
             WHERE section.territory_id IN (SELECT id FROM scope)
               AND (
                 upstream.territory_id IN (SELECT id FROM scope)
                 OR downstream.territory_id IN (SELECT id FROM scope)
               )
           ), merged_waterways AS (
             SELECT scoped.waterway_id,
                    ST_Collect(scoped.geometry ORDER BY scoped.id) AS geometry
             FROM scoped_section_geometries scoped
             GROUP BY scoped.waterway_id
           )
           SELECT waterway.id,
                  ST_AsGeoJSON(merged.geometry)::json AS geometry
           FROM merged_waterways merged
           JOIN waterways waterway ON waterway.id = merged.waterway_id
           ORDER BY waterway.id`,
          [territoryId],
        );
        layers.waterways = waterways.rows;
      }
      if (query.detail === 'network') {
        // A checked-out pg client executes one query at a time. Keep this
        // deliberately serial so a map request does not rely on driver queueing.
        const junctions = await client.query<JunctionRow>(
          `${descendants}
           SELECT junction.id, ST_AsGeoJSON(junction.geometry)::json AS geometry
           FROM network_junctions junction
           WHERE junction.territory_id IN (SELECT id FROM scope)
           ORDER BY junction.id`,
          [territoryId],
        );
        const sections = await client.query<SectionRow>(
          `${descendants}
           SELECT section.id, section.upstream_junction_id, section.downstream_junction_id,
                  upstream.territory_id IN (SELECT id FROM scope) AS upstream_scoped,
                  downstream.territory_id IN (SELECT id FROM scope) AS downstream_scoped,
                   ST_AsGeoJSON(
                     CASE
                       WHEN upstream.territory_id IN (SELECT id FROM scope)
                        AND downstream.territory_id IN (SELECT id FROM scope)
                         THEN section.geometry
                       WHEN upstream.territory_id IN (SELECT id FROM scope)
                         THEN ST_MakeLine(upstream.geometry, upstream.geometry)
                       ELSE ST_MakeLine(downstream.geometry, downstream.geometry)
                     END
                   )::json AS geometry
           FROM water_sections section
            JOIN network_junctions upstream ON upstream.id = section.upstream_junction_id
            JOIN network_junctions downstream ON downstream.id = section.downstream_junction_id
            WHERE section.territory_id IN (SELECT id FROM scope)
              AND (
                upstream.territory_id IN (SELECT id FROM scope)
                OR downstream.territory_id IN (SELECT id FROM scope)
              )
            ORDER BY section.id`,
          [territoryId],
        );
        const stations = await client.query<StationRow>(
          `${descendants}
           SELECT station.id, station.junction_id, row.device_id,
                  ST_AsGeoJSON(station.geometry)::json AS geometry
           FROM live_operations_synthetic_rows row
           JOIN monitoring_stations station ON station.id = row.station_id
           WHERE row.scenario_id = $2 AND row.territory_id IN (SELECT id FROM scope)
           ORDER BY station.id`,
          [territoryId, scenarioId],
        );
        layers.junctions = junctions.rows;
        layers.sections = sections.rows.map((section) => ({
          id: section.id,
          upstreamJunctionId: section.upstream_scoped ? section.upstream_junction_id : null,
          downstreamJunctionId: section.downstream_scoped ? section.downstream_junction_id : null,
          boundary: !section.upstream_scoped || !section.downstream_scoped,
          geometry: section.geometry,
        }));
        layers.stations = stations.rows.map((station) => ({
          id: station.id,
          junctionId: station.junction_id,
          deviceId: station.device_id,
          geometry: station.geometry,
        }));
      }

      const panel = query.stationId
        ? await this.panel(client, territoryId, query.stationId, scenario.provenance)
        : null;
      return {
        referenceAt: scenario.reference_at,
        knownAt: scenario.known_at,
        scenario: source(scenario.provenance),
        detail: query.detail,
        scope: { stationCount: scope.station_count, deviceCount: scope.device_count },
        overview: overviewRows.rows.map((row) => ({
          basinId: row.basin_id,
          basinName: row.basin_name,
          stationCount: row.station_count,
          states: { reported: row.reported, unreliable: row.unreliable, no_data: row.no_data },
        })),
        layers,
        panel,
      };
    });
  }

  private async panel(
    client: Client,
    territoryId: string,
    stationId: string,
    provenance: string,
  ): Promise<MapNetworkResponse['panel']> {
    const result = await client.query<PanelRow>(
      `${descendants}
       SELECT row.station_id, territory.id AS territory_id, territory.code AS territory_code,
              territory.name AS territory_name, row.stage_m::text, row.discharge_m3s::text,
              row.counter_m3::text, row.stage_data_state, row.discharge_data_state,
              row.counter_data_state, ${utc('row.observed_at')} AS observed_at,
              ${utc('row.ingested_at')} AS ingested_at,
              ${utc('row.last_seen_received_at')} AS last_seen_received_at,
              row.connection_status, row.device_fault, row.power_voltage::text,
              row.signal_strength_dbm::text, row.provenance
       FROM live_operations_synthetic_rows row
       JOIN territories territory ON territory.id = row.territory_id
       WHERE row.scenario_id = $2
         AND row.station_id = $3
         AND row.territory_id IN (SELECT id FROM scope)`,
      [territoryId, scenarioId, stationId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const scenarioSource = source(row.provenance || provenance);
    const quantity = (
      value: string | null,
      unit: 'm' | 'm3/s' | 'm3',
      quantityState: DataState,
    ) => ({
      value,
      unit,
      state: quantityState,
      observedAt: row.observed_at,
      ingestedAt: row.ingested_at,
      source: scenarioSource,
    });
    return {
      stationId: row.station_id,
      responsibleTerritory: {
        id: row.territory_id,
        code: row.territory_code,
        name: row.territory_name,
      },
      stage: quantity(row.stage_m, 'm', row.stage_data_state),
      discharge: quantity(row.discharge_m3s, 'm3/s', row.discharge_data_state),
      counter: quantity(row.counter_m3, 'm3', row.counter_data_state),
      health: {
        connection: row.connection_status,
        fault: row.device_fault,
        dataCondition: condition(
          row.stage_data_state === 'no_data' ||
            row.discharge_data_state === 'no_data' ||
            row.counter_data_state === 'no_data'
            ? 'no_data'
            : row.stage_data_state === 'unreliable' ||
                row.discharge_data_state === 'unreliable' ||
                row.counter_data_state === 'unreliable'
              ? 'unreliable'
              : 'reported',
        ),
        lastSeenReceivedAt: row.last_seen_received_at,
        lastObservedAt: row.observed_at,
        power: { value: row.power_voltage, unit: 'V' as const },
        signal: { value: row.signal_strength_dbm, unit: 'dBm' as const },
        source: scenarioSource,
      },
      targetDischarge: noGovernedSource,
      deliveredVolume: noGovernedSource,
      plannedVolume: noGovernedSource,
      variance: noGovernedSource,
      duration: noGovernedSource,
      confidence: noGovernedSource,
      balance: noGovernedSource,
    };
  }

  public async trace(
    territoryId: string,
    stationId: string,
    direction: 'upstream' | 'downstream',
  ): Promise<TraceResponse | null> {
    return this.read(async (client) => {
      const scenario = await this.scenario(client, territoryId);
      if (!scenario) return null;
      const startResult = await client.query<TraceStartRow>(
        `${descendants}
         SELECT station.junction_id
         FROM live_operations_synthetic_rows row
         JOIN monitoring_stations station ON station.id = row.station_id
         WHERE row.scenario_id = $2
           AND row.station_id = $3
           AND row.territory_id IN (SELECT id FROM scope)`,
        [territoryId, scenarioId, stationId],
      );
      const start = startResult.rows[0];
      if (!start) return null;
      const sectionResult = await client.query<SectionRow>(
        `${descendants}
         SELECT section.id, section.upstream_junction_id, section.downstream_junction_id,
                upstream.territory_id IN (SELECT id FROM scope) AS upstream_scoped,
                downstream.territory_id IN (SELECT id FROM scope) AS downstream_scoped,
                ST_AsGeoJSON(section.geometry)::json AS geometry
         FROM water_sections section
         JOIN network_junctions upstream ON upstream.id = section.upstream_junction_id
         JOIN network_junctions downstream ON downstream.id = section.downstream_junction_id
         WHERE section.territory_id IN (SELECT id FROM scope)
         ORDER BY section.id`,
        [territoryId],
      );
      const internal = sectionResult.rows
        .filter((edge) => edge.upstream_scoped && edge.downstream_scoped)
        .map((edge) => ({
          id: edge.id,
          from: edge.upstream_junction_id,
          to: edge.downstream_junction_id,
        }));
      const traversal = boundedDirectedTrace(start.junction_id, internal, direction, traceCap);
      const boundaryCandidates = sectionResult.rows.filter((edge) => {
        if (edge.upstream_scoped && edge.downstream_scoped) return false;
        return direction === 'downstream'
          ? edge.upstream_scoped && traversal.nodes.includes(edge.upstream_junction_id)
          : edge.downstream_scoped && traversal.nodes.includes(edge.downstream_junction_id);
      });
      const capacity = Math.max(0, traceCap - traversal.edges.length);
      const boundary = boundaryCandidates.slice(0, capacity);
      return {
        stationId,
        direction,
        nodes: traversal.nodes,
        edges: [
          ...traversal.edges.map((edge) => ({
            sectionId: edge.id,
            from: edge.from,
            to: edge.to,
            boundary: false,
          })),
          ...boundary.map((edge) => ({
            sectionId: edge.id,
            from: edge.upstream_scoped ? edge.upstream_junction_id : null,
            to: edge.downstream_scoped ? edge.downstream_junction_id : null,
            boundary: true,
          })),
        ],
        truncated: traversal.truncated || boundaryCandidates.length > boundary.length,
        disclaimer:
          'Directed topology only. Boundary endpoint identities are redacted; no hydraulic inference or control action is represented.',
      };
    });
  }

  public async playback(territoryId: string, stationId: string): Promise<PlaybackResponse | null> {
    return this.read(async (client) => {
      const result = await client.query<PlaybackRow>(
        `${descendants}
         SELECT ${utc('point.point_at')} AS at, point.raw_value::text AS raw,
                point.validated_value::text AS validated, point.gap,
                ${utc('scenario.reference_at')} AS reference_at,
                ${utc('scenario.known_at')} AS known_at, scenario.provenance
         FROM live_operations_synthetic_trend_points point
         JOIN live_operations_synthetic_scenarios scenario ON scenario.id = point.scenario_id
         JOIN live_operations_synthetic_rows row
           ON row.scenario_id = point.scenario_id AND row.station_id = point.station_id
         WHERE point.scenario_id = $2
           AND point.station_id = $3
           AND point.point_at <= scenario.reference_at
           AND row.territory_id IN (SELECT id FROM scope)
         ORDER BY point.point_at`,
        [territoryId, scenarioId, stationId],
      );
      if (result.rows.length !== 24) return null;
      const first = result.rows[0]!;
      const scenarioSource = source(first.provenance);
      return {
        stationId,
        unit: 'm',
        referenceAt: first.reference_at,
        knownAt: first.known_at,
        paused: true,
        frames: result.rows.map((frame) => ({
          at: frame.at,
          raw: frame.raw,
          validated: frame.validated,
          gap: frame.gap,
          source: scenarioSource,
        })),
        disclaimer:
          'Paused synthetic stage playback only. Gaps are retained and no interpolation, live history, or official telemetry is implied.',
      };
    });
  }
}
