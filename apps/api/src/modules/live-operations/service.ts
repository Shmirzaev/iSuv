import type {
  LiveOperationsInspector,
  LiveOperationsQuery,
  LiveOperationsResponse,
  LiveOperationsRow,
} from '@isuv/contracts';
import { attentionPresentation, liveAttention } from '@isuv/domain';
import { withDatabase } from '../../db/client.js';
import type { PostgresDeviceHealthService } from '../device-health/service.js';

const scenarioId = 'd6000000-0000-4000-8000-000000000001';
const ts = (value: string) =>
  `to_char(${value} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
type Client = { query: <T>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }> };
type DataState = 'reported' | 'unreliable' | 'no_data';
type Quality = 'unknown' | 'valid' | 'suspect' | 'invalid' | 'estimated';
type Workflow =
  'raw' | 'automatically_validated' | 'expert_validated' | 'corrected' | 'estimated' | 'rejected';

interface Overlay {
  observationId: string;
  lineageId: string;
  value: string;
  quality: Quality;
  workflow: Workflow;
  observedAt: string;
  ingestedAt: string;
  revision: number;
  qualityReason: string | null;
  uncertainty: string | null;
  uncertaintyMethod: string | null;
  measurementMethod: string | null;
  calibrationRef: string | null;
  ratingCurveRef: string | null;
  provenance: string;
  classification: 'synthetic' | 'official';
}

interface RevisionRow {
  observation_id: string;
  lineage_id: string;
  revision: number;
  workflow: Workflow;
  quality: Quality;
  value: string;
  unit: 'm' | 'm3/s' | 'm3';
  observed_at: string;
  ingested_at: string;
  reason: string | null;
  provenance: string;
  classification: 'synthetic' | 'official';
}

interface Raw {
  reference_at: string;
  known_at: string;
  scenario_provenance: string;
  version: number;
  station_id: string;
  station_code: string;
  station_name: string;
  device_id: string;
  device_code: string;
  device_name: string;
  protocol: string;
  installation_id: string;
  installation_provenance: string;
  territory_id: string;
  territory_name: string;
  territory_code: string;
  territory_depth: number;
  territory_path: string[];
  waterway_id: string | null;
  waterway_name: string | null;
  waterway_code: string | null;
  section_id: string | null;
  section_name: string | null;
  section_code: string | null;
  stage_sensor_id: string;
  discharge_sensor_id: string;
  counter_sensor_id: string;
  stage_data_state: DataState;
  discharge_data_state: DataState;
  counter_data_state: DataState;
  stage_m: string | null;
  discharge_m3s: string | null;
  counter_m3: string | null;
  observed_at: string | null;
  ingested_at: string | null;
  connection_status: 'communicating' | 'offline' | 'unknown';
  device_fault: 'reported' | 'none' | 'unknown';
  fault_code: string | null;
  health_condition: 'current' | 'stale' | 'unreliable' | 'unknown' | 'no_data' | 'unconfigured';
  health_received_at: string | null;
  health_age_microseconds: string | null;
  health_canonical: boolean;
  health_provenance: string | null;
  health_classification: 'synthetic' | 'official' | null;
  power: string | null;
  signal: string | null;
  stage_overlay: Overlay | null;
  discharge_overlay: Overlay | null;
  counter_overlay: Overlay | null;
}

const syntheticSource = (label: string) => ({
  kind: 'synthetic_scenario' as const,
  label,
  official: false,
  provenance: label,
});
const unconfigured = {
  state: 'unconfigured' as const,
  source: 'unconfigured' as const,
  reason: 'No governed source is configured for this field.',
};

function fingerprint(query: LiveOperationsQuery): string {
  return JSON.stringify({ ...query, cursor: undefined });
}
function encodeCursor(query: LiveOperationsQuery, row: LiveOperationsRow): string {
  return Buffer.from(
    JSON.stringify({ f: fingerprint(query), code: row.station.code, id: row.stationId }),
  ).toString('base64url');
}
function decodeCursor(
  value: string | undefined,
  query: LiveOperationsQuery,
): { code: string; id: string } | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('f' in parsed) ||
      !('code' in parsed) ||
      !('id' in parsed) ||
      parsed.f !== fingerprint(query) ||
      typeof parsed.code !== 'string' ||
      typeof parsed.id !== 'string'
    )
      throw new Error();
    return { code: parsed.code, id: parsed.id };
  } catch {
    throw new Error('CURSOR');
  }
}
function makeQuantity(
  sensorId: string,
  kind: 'stage' | 'discharge' | 'accumulated_volume',
  unit: 'm' | 'm3/s' | 'm3',
  fallbackValue: string | null,
  fallbackState: DataState,
  raw: Raw,
  overlay: Overlay | null,
) {
  if (overlay) {
    const usable =
      overlay.quality === 'valid' && overlay.workflow !== 'raw' && overlay.workflow !== 'rejected';
    return {
      sensorId,
      kind,
      unit,
      value: overlay.value,
      dataState: usable ? ('reported' as const) : ('unreliable' as const),
      quality: overlay.quality,
      observedAt: overlay.observedAt,
      ingestedAt: overlay.ingestedAt,
      revision: overlay.revision,
      lineageId: overlay.lineageId,
      observationId: overlay.observationId,
      workflow: overlay.workflow,
      qualityReason: overlay.qualityReason,
      uncertainty: overlay.uncertainty,
      uncertaintyMethod: overlay.uncertaintyMethod,
      measurementMethod: overlay.measurementMethod,
      calibrationRef: overlay.calibrationRef,
      ratingCurveRef: overlay.ratingCurveRef,
      source: {
        kind: 'canonical_observation' as const,
        label: overlay.provenance,
        official: overlay.classification === 'official',
        provenance: overlay.provenance,
      },
    };
  }
  const noData = fallbackState === 'no_data' || fallbackValue === null;
  return {
    sensorId,
    kind,
    unit,
    value: noData ? null : fallbackValue,
    dataState: noData ? ('no_data' as const) : fallbackState,
    quality: noData || fallbackState === 'unreliable' ? ('unknown' as const) : ('valid' as const),
    observedAt: noData ? null : raw.observed_at,
    ingestedAt: noData ? null : raw.ingested_at,
    revision: noData ? null : 1,
    lineageId: null,
    observationId: null,
    workflow: noData ? null : ('synthetic_scenario' as const),
    qualityReason:
      fallbackState === 'unreliable' ? 'Synthetic scenario marks this value unreliable.' : null,
    uncertainty: null,
    uncertaintyMethod: null,
    measurementMethod: null,
    calibrationRef: null,
    ratingCurveRef: null,
    source: syntheticSource('synthetic live operations scenario; not official telemetry'),
  };
}

function mapRow(raw: Raw): LiveOperationsRow {
  const stage = makeQuantity(
    raw.stage_sensor_id,
    'stage',
    'm',
    raw.stage_m,
    raw.stage_data_state,
    raw,
    raw.stage_overlay,
  );
  const discharge = makeQuantity(
    raw.discharge_sensor_id,
    'discharge',
    'm3/s',
    raw.discharge_m3s,
    raw.discharge_data_state,
    raw,
    raw.discharge_overlay,
  );
  const accumulatedCounter = makeQuantity(
    raw.counter_sensor_id,
    'accumulated_volume',
    'm3',
    raw.counter_m3,
    raw.counter_data_state,
    raw,
    raw.counter_overlay,
  );
  const states = [stage.dataState, discharge.dataState, accumulatedCounter.dataState];
  const overall: DataState = states.includes('no_data')
    ? 'no_data'
    : states.includes('unreliable')
      ? 'unreliable'
      : 'reported';
  const attention = liveAttention({
    dataState: overall,
    connection: raw.connection_status,
    fault: raw.device_fault,
  });
  const lastObservedAt =
    [stage.observedAt, discharge.observedAt, accumulatedCounter.observedAt]
      .filter((value): value is string => value !== null)
      .sort()
      .at(-1) ?? null;
  const canonicalHealth = raw.health_canonical;
  const healthProvenance =
    raw.health_provenance ?? 'synthetic live operations scenario; not official telemetry';
  return {
    deviceId: raw.device_id,
    stationId: raw.station_id,
    territory: { id: raw.territory_id, code: raw.territory_code, name: raw.territory_name },
    waterway: {
      id: raw.waterway_id,
      name: raw.waterway_name,
      sectionId: raw.section_id,
      sectionName: raw.section_name,
    },
    station: { code: raw.station_code, name: raw.station_name },
    device: {
      code: raw.device_code,
      name: raw.device_name,
      protocol: raw.protocol,
      installationId: raw.installation_id,
      installationProvenance: raw.installation_provenance,
    },
    quantities: { stage, discharge, accumulatedCounter },
    health: {
      connection: raw.connection_status,
      fault: raw.device_fault,
      faultCode: raw.fault_code,
      dataCondition: canonicalHealth
        ? raw.health_condition
        : overall === 'reported'
          ? 'current'
          : overall === 'no_data'
            ? 'no_data'
            : 'unreliable',
      freshness: 'unconfigured',
      lastSeenReceivedAt: raw.health_received_at,
      lastObservedAt,
      ageMicroseconds: raw.health_age_microseconds,
      power:
        raw.power === null
          ? { state: 'unknown' }
          : { state: 'measured', value: raw.power, unit: 'V' },
      signal:
        raw.signal === null
          ? { state: 'unknown' }
          : { state: 'measured', value: raw.signal, unit: 'dBm' },
      source: canonicalHealth
        ? {
            kind: 'canonical_device_health',
            label: healthProvenance,
            official: raw.health_classification === 'official',
            provenance: healthProvenance,
          }
        : syntheticSource(healthProvenance),
    },
    governed: {
      plan: unconfigured,
      intervalVariance: unconfigured,
      waterStatus: unconfigured,
      calibrationDue: unconfigured,
      alarm: unconfigured,
      incident: unconfigured,
    },
    attention: { state: attention, ...attentionPresentation(attention) },
    synthetic: true,
    provenance: raw.scenario_provenance,
  };
}

const observationJoin = (alias: string, sensor: string) => `LEFT JOIN LATERAL (
  SELECT jsonb_build_object(
    'observationId',revision.id,'lineageId',lineage.id,'value',revision.value::text,
    'quality',revision.quality_state::text,'workflow',revision.state::text,
    'observedAt',${ts('lineage.observed_at')},'ingestedAt',${ts('revision.ingested_at')},
    'revision',revision.revision,'qualityReason',revision.quality_reason,
    'uncertainty',revision.uncertainty::text,'uncertaintyMethod',revision.uncertainty_method,
    'measurementMethod',revision.measurement_method,'calibrationRef',revision.calibration_ref,
    'ratingCurveRef',revision.rating_curve_ref,'provenance',revision.provenance,
    'classification',revision.data_classification::text) data
  FROM observation_lineages lineage JOIN observation_revisions revision ON revision.lineage_id=lineage.id
  WHERE lineage.sensor_id=base.${sensor} AND lineage.observed_at<=base.reference_at
    AND lineage.device_id=base.device_id
    AND lineage.device_installation_id=base.installation_id
    AND lineage.station_id=base.station_id
    AND lineage.territory_id=base.territory_id
    AND revision.ingested_at<=base.known_at
  ORDER BY lineage.observed_at DESC,revision.ingested_at DESC,revision.revision DESC LIMIT 1
) ${alias} ON true`;

export class PostgresLiveOperationsService {
  public constructor(
    private readonly databaseUrl?: string,
    private readonly health?: PostgresDeviceHealthService,
  ) {}
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
  public async findDefaultTerritory(userId: string, organizationId: string, at: Date) {
    return this.read(
      async (client) =>
        (
          await client.query<{ territory_id: string }>(
            `SELECT COALESCE((SELECT territory_id FROM user_role_grants WHERE user_id=$1
            AND organization_id=$2 AND territory_id IS NOT NULL AND cancelled_at IS NULL
            AND effective_from<=$3 AND (effective_until IS NULL OR effective_until>$3)
            ORDER BY effective_from,id LIMIT 1),(SELECT territory_id
            FROM live_operations_synthetic_scenarios WHERE id=$4 AND organization_id=$2)) territory_id`,
            [userId, organizationId, at, scenarioId],
          )
        ).rows[0]?.territory_id ?? null,
    );
  }
  public async descendantTerritoryIds(territoryId: string): Promise<string[]> {
    return this.read(async (client) =>
      (
        await client.query<{ id: string }>(
          `WITH RECURSIVE d AS (SELECT id FROM territories WHERE id=$1 UNION ALL
           SELECT t.id FROM territories t JOIN d ON t.parent_territory_id=d.id)
           SELECT id FROM d ORDER BY id`,
          [territoryId],
        )
      ).rows.map((row) => row.id),
    );
  }
  private async raw(client: Client, territoryId: string): Promise<Raw[]> {
    return (
      await client.query<Raw>(
        `WITH RECURSIVE descendants AS (
          SELECT id,parent_territory_id,0 depth,ARRAY[id]::uuid[] path FROM territories WHERE id=$1
          UNION ALL SELECT t.id,t.parent_territory_id,d.depth+1,d.path||t.id FROM territories t
          JOIN descendants d ON t.parent_territory_id=d.id WHERE NOT t.id=ANY(d.path)
        ), base AS (
          SELECT scenario.reference_at,scenario.known_at,scenario.provenance scenario_provenance,
            scenario.version,row.*,station.code station_code,station.name station_name,
            device.code device_code,device.name device_name,device.protocol::text protocol,
            installation.provenance installation_provenance,territory.name territory_name,
            territory.code territory_code,descendants.depth territory_depth,
            descendants.path territory_path,section.id section_id,section.name section_name,
            section.code section_code,waterway.id waterway_id,waterway.name waterway_name,
            waterway.code waterway_code,
            (SELECT id FROM telemetry_sensors s WHERE s.device_id=row.device_id AND s.measurement_kind='stage' ORDER BY id LIMIT 1) stage_sensor_id,
            (SELECT id FROM telemetry_sensors s WHERE s.device_id=row.device_id AND s.measurement_kind='discharge' ORDER BY id LIMIT 1) discharge_sensor_id,
            (SELECT id FROM telemetry_sensors s WHERE s.device_id=row.device_id AND s.measurement_kind='accumulated_volume' ORDER BY id LIMIT 1) counter_sensor_id
          FROM live_operations_synthetic_scenarios scenario
          JOIN live_operations_synthetic_rows row ON row.scenario_id=scenario.id
          JOIN descendants ON descendants.id=row.territory_id
          JOIN monitoring_stations station ON station.id=row.station_id
          JOIN telemetry_devices device ON device.id=row.device_id
          JOIN telemetry_device_installations installation ON installation.id=row.installation_id
          JOIN territories territory ON territory.id=row.territory_id
          LEFT JOIN water_sections section ON section.id=station.section_id
          LEFT JOIN waterways waterway ON waterway.id=section.waterway_id WHERE scenario.id=$2
        ) SELECT base.*,
          ${ts('base.reference_at')} reference_at,${ts('base.known_at')} known_at,
          ${ts('base.observed_at')} observed_at,${ts('base.ingested_at')} ingested_at,
          COALESCE(health.connection_status::text,base.connection_status::text) connection_status,
          COALESCE(health.device_fault,base.device_fault) device_fault,
          CASE WHEN health.id IS NULL THEN base.fault_code ELSE health.fault_code END fault_code,
          COALESCE(health.data_condition,'unconfigured') health_condition,
          health.id IS NOT NULL health_canonical,
          ${ts('COALESCE(health_seen.received_at,base.last_seen_received_at)')} health_received_at,
          CASE WHEN COALESCE(health_seen.received_at,base.last_seen_received_at)<=base.known_at
            THEN trunc(extract(epoch FROM (base.known_at-COALESCE(health_seen.received_at,base.last_seen_received_at)))*1000000)::text
            ELSE NULL END health_age_microseconds,
          health.provenance health_provenance,
          health.data_classification::text health_classification,
          COALESCE(health.power_voltage,base.power_voltage)::text power,
          COALESCE(health.signal_strength_dbm,base.signal_strength_dbm)::text signal,
          stage.data stage_overlay,
          discharge.data discharge_overlay,counter.data counter_overlay
        FROM base LEFT JOIN LATERAL (
          SELECT event.* FROM device_health_events event WHERE event.device_id=base.device_id
            AND event.device_installation_id=base.installation_id
            AND event.occurred_at<=base.reference_at AND event.received_at<=base.known_at
          ORDER BY event.occurred_at DESC,event.state_priority DESC,
            (event.source_system||':'||event.source_event_id) DESC LIMIT 1
        ) health ON true
        LEFT JOIN LATERAL (
          SELECT event.received_at FROM device_health_events event
          WHERE event.device_id=base.device_id AND event.device_installation_id=base.installation_id
            AND event.occurred_at<=base.reference_at AND event.received_at<=base.known_at
          ORDER BY event.received_at DESC,event.id DESC LIMIT 1
        ) health_seen ON true
        ${observationJoin('stage', 'stage_sensor_id')}
        ${observationJoin('discharge', 'discharge_sensor_id')}
        ${observationJoin('counter', 'counter_sensor_id')}
        ORDER BY base.station_code,base.station_id`,
        [territoryId, scenarioId],
      )
    ).rows;
  }
  public async list(
    territoryId: string,
    query: LiveOperationsQuery,
  ): Promise<LiveOperationsResponse | null> {
    return this.read(async (client) => {
      const raw = await this.raw(client, territoryId);
      if (!raw.length) return null;
      const after = decodeCursor(query.cursor, query);
      const scoped = raw.map(mapRow);
      const filtered = scoped.filter((row) => {
        const quantities = Object.values(row.quantities);
        return (
          (!query.measurementKind ||
            quantities.some(
              (q) => q.kind === query.measurementKind && q.dataState !== 'no_data',
            )) &&
          (!query.connection || row.health.connection === query.connection) &&
          (!query.fault || row.health.fault === query.fault) &&
          (!query.dataState || quantities.some((q) => q.dataState === query.dataState)) &&
          (!query.quality || quantities.some((q) => q.quality === query.quality)) &&
          (!query.attention || row.attention.state === query.attention) &&
          (!query.waterwayId || row.waterway.id === query.waterwayId) &&
          (!query.sectionId || row.waterway.sectionId === query.sectionId) &&
          (!query.stationId || row.stationId === query.stationId) &&
          (!query.deviceId || row.deviceId === query.deviceId)
        );
      });
      const candidates = after
        ? filtered.filter(
            (row) =>
              row.station.code > after.code ||
              (row.station.code === after.code && row.stationId > after.id),
          )
        : filtered;
      const page = candidates.slice(0, query.limit);
      const unique = <T extends { id: string }>(items: T[]) => [
        ...new Map(items.map((item) => [item.id, item])).values(),
      ];
      const first = raw[0]!;
      return {
        referenceAt: first.reference_at,
        knownAt: first.known_at,
        presentationTimeZone: 'Asia/Tashkent',
        scenario: {
          id: scenarioId,
          version: first.version,
          provenance: first.scenario_provenance,
          dataClassification: 'synthetic',
          officialTelemetry: false,
        },
        scope: { stationDenominator: scoped.length, deviceDenominator: scoped.length },
        facets: {
          territories: unique(
            raw.map((row) => ({
              id: row.territory_id,
              code: row.territory_code,
              name: row.territory_name,
              depth: row.territory_depth,
              path: row.territory_path,
            })),
          ),
          waterways: unique(
            raw
              .filter((row) => row.waterway_id !== null)
              .map((row) => ({
                id: row.waterway_id!,
                code: row.waterway_code,
                name: row.waterway_name,
              })),
          ),
          sections: unique(
            raw
              .filter((row) => row.section_id !== null)
              .map((row) => ({
                id: row.section_id!,
                code: row.section_code,
                name: row.section_name,
              })),
          ),
          stations: unique(
            raw.map((row) => ({
              id: row.station_id,
              code: row.station_code,
              name: row.station_name,
            })),
          ),
          devices: unique(
            raw.map((row) => ({
              id: row.device_id,
              code: row.device_code,
              name: row.device_name,
            })),
          ),
          measurementKinds: ['stage', 'discharge', 'accumulated_volume'],
          connections: ['communicating', 'offline', 'unknown'],
          faults: ['reported', 'none', 'unknown'],
          dataStates: ['reported', 'unreliable', 'no_data'],
          qualities: ['unknown', 'valid', 'suspect', 'invalid', 'estimated'],
          attentions: ['attention', 'unreliable', 'no_data', 'reported'],
        },
        rows: page,
        nextCursor: candidates.length > query.limit ? encodeCursor(query, page.at(-1)!) : null,
      };
    });
  }
  public async inspector(deviceId: string, territoryId: string) {
    const result = await this.list(territoryId, { deviceId, limit: 1 });
    const current = result?.rows[0];
    if (!result || !current) return null;
    const trend = await this.read(async (client) =>
      (
        await client.query<{
          at: string;
          raw: string | null;
          validated: string | null;
          gap: boolean;
        }>(
          `SELECT ${ts('point_at')} at,raw_value::text raw,validated_value::text validated,gap
           FROM live_operations_synthetic_trend_points WHERE scenario_id=$1 AND station_id=$2
             AND sensor_kind='stage' AND point_at<=$3::timestamptz
           ORDER BY point_at DESC LIMIT 24`,
          [scenarioId, current.stationId, result.referenceAt],
        )
      ).rows.reverse(),
    );
    const stage = current.quantities.stage;
    const canonicalRevisions = stage.lineageId
      ? await this.read(
          async (client) =>
            (
              await client.query<RevisionRow>(
                `SELECT revision.id observation_id,lineage.id lineage_id,revision.revision,
                   revision.state::text workflow,revision.quality_state::text quality,
                   revision.value::text value,revision.unit::text unit,
                   ${ts('lineage.observed_at')} observed_at,${ts('revision.ingested_at')} ingested_at,
                   revision.quality_reason reason,revision.provenance,
                   revision.data_classification::text classification
                 FROM observation_lineages lineage
                 JOIN observation_revisions revision ON revision.lineage_id=lineage.id
                 WHERE lineage.id=$1 AND lineage.observed_at<=$2::timestamptz
                   AND revision.ingested_at<=$3::timestamptz
                 ORDER BY revision.revision,revision.ingested_at,revision.id LIMIT 25`,
                [stage.lineageId, result.referenceAt, result.knownAt],
              )
            ).rows,
        )
      : [];
    const revisions = canonicalRevisions.length
      ? canonicalRevisions.map((revision) => ({
          observationId: revision.observation_id,
          lineageId: revision.lineage_id,
          revision: revision.revision,
          workflow: revision.workflow,
          quality: revision.quality,
          value: revision.value,
          unit: revision.unit,
          observedAt: revision.observed_at,
          ingestedAt: revision.ingested_at,
          reason: revision.reason,
          source: {
            kind: 'canonical_observation' as const,
            label: revision.provenance,
            official: revision.classification === 'official',
            provenance: revision.provenance,
          },
        }))
      : stage.value === null || stage.observedAt === null || stage.ingestedAt === null
        ? []
        : [
            {
              observationId: null,
              lineageId: null,
              revision: stage.revision ?? 1,
              workflow: stage.workflow ?? 'synthetic_scenario',
              quality: stage.quality,
              value: stage.value,
              unit: stage.unit,
              observedAt: stage.observedAt,
              ingestedAt: stage.ingestedAt,
              reason: stage.qualityReason,
              source: stage.source,
            },
          ];
    return {
      referenceAt: result.referenceAt,
      knownAt: result.knownAt,
      current,
      trend: trend.map((point) => ({
        ...point,
        kind: 'stage' as const,
        unit: 'm' as const,
        source: syntheticSource('synthetic immutable trend; not official telemetry'),
      })),
      revisions,
      healthHistory: {
        state: 'unconfigured' as const,
        source: 'unconfigured' as const,
        reason:
          'Health history is not synthesized; use the governed device-health history endpoint when available.',
      },
      placeholders: {
        plan: 'unconfigured' as const,
        intervalVariance: 'unconfigured' as const,
        alarms: 'unconfigured' as const,
        incidents: 'unconfigured' as const,
        maintenance: 'unconfigured' as const,
        firmware: 'unconfigured' as const,
        documents: 'unconfigured' as const,
      },
    } satisfies LiveOperationsInspector;
  }
  public async live(organizationId: string, after: bigint | null, territoryIds: string[]) {
    return (
      this.health?.live(organizationId, after, 250, undefined, territoryIds) ?? {
        reset: false,
        events: [],
      }
    );
  }
}
