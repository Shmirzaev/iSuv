import { createHash } from 'node:crypto';
import type {
  DeviceHealthEvent,
  DeviceHealthHistoryQuery,
  DeviceHealthSnapshot,
  IngestDeviceHealthEventRequest,
  Observation,
  TelemetryStatus,
} from '@isuv/contracts';
import { projectDeviceHealth } from '@isuv/domain';
import type { PoolClient } from 'pg';
import { withDatabase } from '../../db/client.js';

export class DeviceHealthError extends Error {
  public constructor(
    public readonly kind: 'NOT_FOUND' | 'CONFLICT' | 'UNAVAILABLE',
    message: string,
  ) {
    super(message);
  }
}

interface HealthEventRow {
  id: string;
  organization_id: string;
  territory_id: string;
  device_id: string;
  device_installation_id: string;
  source_system: string;
  source_event_id: string;
  occurred_at: string;
  received_at: string;
  connection_status: DeviceHealthEvent['connectionStatus'];
  device_fault: DeviceHealthEvent['deviceFault'];
  fault_code: string | null;
  power_voltage: string | null;
  signal_strength_dbm: string | null;
  provenance: string;
  data_classification: DeviceHealthEvent['dataClassification'];
  data_condition: DeviceHealthEvent['dataCondition'];
  live_event_id?: string;
}
interface SnapshotRow extends HealthEventRow {
  last_seen_received_at: string;
  last_observed_at: string | null;
  current_data_condition: DeviceHealthEvent['dataCondition'];
  current_connection_status: DeviceHealthEvent['connectionStatus'];
  current_device_fault: DeviceHealthEvent['deviceFault'];
  current_fault_code: string | null;
  current_power_voltage: string | null;
  current_signal_strength_dbm: string | null;
  current_provenance: string;
  current_classification: DeviceHealthEvent['dataClassification'];
  latest_live_event_id: string;
}
const eventSelect = `SELECT event.id, event.organization_id, event.territory_id, event.device_id, event.device_installation_id,
  event.source_system, event.source_event_id,
  to_char(event.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') occurred_at,
  to_char(event.received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') received_at,
  event.connection_status::text connection_status, event.device_fault, event.fault_code, event.power_voltage::text, event.signal_strength_dbm::text,
  event.provenance, event.data_classification::text, event.data_condition`;
function eventFromRow(row: HealthEventRow): DeviceHealthEvent {
  return {
    id: row.id,
    organizationId: row.organization_id,
    territoryId: row.territory_id,
    deviceId: row.device_id,
    deviceInstallationId: row.device_installation_id,
    sourceSystem: row.source_system,
    sourceEventId: row.source_event_id,
    occurredAt: row.occurred_at,
    receivedAt: row.received_at,
    connectionStatus: row.connection_status,
    deviceFault: row.device_fault,
    dataCondition: row.data_condition,
    faultCode: row.fault_code,
    power:
      row.power_voltage === null
        ? { state: 'unknown' }
        : { state: 'measured', value: row.power_voltage, unit: 'V' },
    signal:
      row.signal_strength_dbm === null
        ? { state: 'unknown' }
        : { state: 'measured', value: row.signal_strength_dbm, unit: 'dBm' },
    provenance: row.provenance,
    dataClassification: row.data_classification,
    synthetic: row.data_classification === 'synthetic',
  };
}
function payloadHash(input: IngestDeviceHealthEventRequest): string {
  return `sha256:${createHash('sha256')
    .update(
      JSON.stringify({
        deviceId: input.deviceId,
        sourceSystem: input.sourceSystem,
        sourceEventId: input.sourceEventId,
        occurredAt: input.occurredAt,
        connectionStatus: input.connectionStatus,
        deviceFault: input.deviceFault,
        faultCode: input.faultCode,
        dataCondition: input.dataCondition,
        power: input.power,
        signal: input.signal,
        provenance: input.provenance,
        dataClassification: input.dataClassification,
      }),
    )
    .digest('hex')}`;
}
function encodeHistoryCursor(row: HealthEventRow): string {
  return Buffer.from(JSON.stringify([row.received_at, row.id])).toString('base64url');
}
function decodeHistoryCursor(cursor: string): [string, string] {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!Array.isArray(value) || typeof value[0] !== 'string' || typeof value[1] !== 'string')
      throw new Error();
    return [value[0], value[1]];
  } catch {
    throw new DeviceHealthError('NOT_FOUND', 'Device health was not found.');
  }
}

export class PostgresDeviceHealthService {
  public constructor(
    private readonly databaseUrl: string | undefined,
    private readonly transactionClient?: PoolClient,
    private readonly now: () => Date = () => new Date(),
  ) {}
  private async transaction<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    if (this.transactionClient) return action(this.transactionClient);
    return withDatabase(this.databaseUrl, async (pool) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const output = await action(client);
        await client.query('COMMIT');
        return output;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    });
  }
  private async read<T>(action: (client: Pick<PoolClient, 'query'>) => Promise<T>): Promise<T> {
    if (this.transactionClient) return action(this.transactionClient);
    return withDatabase(this.databaseUrl, action);
  }
  public async resolveDeviceTerritory(deviceId: string, at: string): Promise<string | null> {
    return this.read(
      async (client) =>
        (
          await client.query<{ territory_id: string }>(
            `SELECT installation.territory_id FROM telemetry_device_installations installation
       JOIN telemetry_devices device ON device.id = installation.device_id AND device.organization_id = installation.organization_id
       WHERE installation.device_id = $1 AND installation.effective_from <= $2::timestamptz
       AND (installation.effective_until IS NULL OR installation.effective_until > $2::timestamptz)`,
            [deviceId, at],
          )
        ).rows[0]?.territory_id ?? null,
    );
  }
  public async findCurrentTerritory(deviceId: string): Promise<string | null> {
    return this.read(
      async (client) =>
        (
          await client.query<{ territory_id: string }>(
            'SELECT territory_id FROM device_health_current WHERE device_id = $1',
            [deviceId],
          )
        ).rows[0]?.territory_id ?? null,
    );
  }
  public async listOccurrenceTerritories(deviceId: string): Promise<string[]> {
    return this.read(async (client) =>
      (
        await client.query<{ territory_id: string }>(
          'SELECT DISTINCT territory_id FROM device_health_events WHERE device_id=$1',
          [deviceId],
        )
      ).rows.map((row) => row.territory_id),
    );
  }
  /** Public status ingress: numeric data condition and classification are not caller authority. */
  public async ingest(
    input: IngestDeviceHealthEventRequest,
    expectedTerritoryId?: string,
  ): Promise<{ event: DeviceHealthEvent; idempotent: boolean }> {
    return this.persist({ ...input, dataCondition: 'unconfigured' }, expectedTerritoryId);
  }
  private async persist(
    input: IngestDeviceHealthEventRequest,
    expectedTerritoryId?: string,
    receivedAtOverride?: string,
    preserveReportedFault = false,
    statePriority = 2,
    deviceInstallationIdOverride?: string,
  ): Promise<{ event: DeviceHealthEvent; idempotent: boolean }> {
    const hash = payloadHash(input);
    return this.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 41))', [
        `${input.sourceSystem}:${input.sourceEventId}`,
      ]);
      const prior = await client.query<HealthEventRow & { source_payload_hash: string }>(
        `${eventSelect}, event.source_payload_hash FROM device_health_events event
          WHERE event.source_system = $1 AND event.source_event_id = $2
          AND event.organization_id = (SELECT organization_id FROM telemetry_devices WHERE id = $3)`,
        [input.sourceSystem, input.sourceEventId, input.deviceId],
      );
      if (prior.rows[0]) {
        if (prior.rows[0].source_payload_hash !== hash)
          throw new DeviceHealthError(
            'CONFLICT',
            'Source event ID was reused with different health content.',
          );
        return { event: eventFromRow(prior.rows[0]), idempotent: true };
      }
      const inserted = await client.query<HealthEventRow>(
        `WITH inserted AS (INSERT INTO device_health_events (organization_id, territory_id, device_id, device_installation_id, source_system, source_event_id, source_payload_hash, occurred_at, received_at, connection_status, device_fault, fault_code, power_voltage, signal_strength_dbm, provenance, data_classification, data_condition, state_priority)
           SELECT device.organization_id, installation.territory_id, device.id, installation.id, $2,$3,$4,$5::timestamptz,$6::timestamptz,$7::device_connection_status,$8,$9,$10::numeric,$11::numeric,$12,
             CASE WHEN $13::record_data_classification='synthetic' OR device.data_classification='synthetic' OR installation.data_classification='synthetic' THEN 'synthetic'::record_data_classification ELSE 'official'::record_data_classification END,
             $14,$15::smallint
           FROM telemetry_devices device JOIN telemetry_device_installations installation ON installation.device_id=device.id AND installation.organization_id=device.organization_id
           WHERE device.id=$1
             AND (($17::uuid IS NOT NULL AND installation.id=$17::uuid)
               OR ($17::uuid IS NULL AND installation.effective_from <= $5::timestamptz AND (installation.effective_until IS NULL OR installation.effective_until > $5::timestamptz)))
             AND ($16::uuid IS NULL OR installation.territory_id = $16::uuid)
           RETURNING *) ${eventSelect} FROM inserted event`,
        [
          input.deviceId,
          input.sourceSystem,
          input.sourceEventId,
          hash,
          input.occurredAt,
          receivedAtOverride ?? this.now().toISOString(),
          input.connectionStatus,
          input.deviceFault,
          input.faultCode,
          input.power.state === 'measured' ? input.power.value : null,
          input.signal.state === 'measured' ? input.signal.value : null,
          input.provenance,
          input.dataClassification,
          input.dataCondition,
          statePriority,
          expectedTerritoryId ?? null,
          deviceInstallationIdOverride ?? null,
        ],
      );
      if (!inserted.rows[0])
        throw new DeviceHealthError('NOT_FOUND', 'Device health target was not found.');
      const event = inserted.rows[0];
      const journal = await client.query<{ id: string }>(
        `INSERT INTO device_live_event_journal (organization_id, territory_id, device_id, health_event_id)
         VALUES ($1,$2,$3,$4) RETURNING id::text`,
        [event.organization_id, event.territory_id, event.device_id, event.id],
      );
      await client.query(
        `INSERT INTO device_health_current (device_id,organization_id,territory_id,device_installation_id,latest_event_id,connection_status,device_fault,last_seen_received_at,state_occurred_at,state_priority,state_order_key,last_observed_at,fault_code,power_voltage,signal_strength_dbm,provenance,data_classification,data_condition)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9::timestamptz,$10,$11,NULL,$12,$13::numeric,$14::numeric,$15,$16::record_data_classification,$17)
         ON CONFLICT (device_id) DO UPDATE SET
           last_seen_received_at = GREATEST(device_health_current.last_seen_received_at, EXCLUDED.last_seen_received_at),
           latest_event_id = CASE WHEN (EXCLUDED.state_occurred_at,EXCLUDED.state_priority,EXCLUDED.state_order_key) >= (device_health_current.state_occurred_at,device_health_current.state_priority,device_health_current.state_order_key) THEN EXCLUDED.latest_event_id ELSE device_health_current.latest_event_id END,
           territory_id = CASE WHEN (EXCLUDED.state_occurred_at,EXCLUDED.state_priority,EXCLUDED.state_order_key) >= (device_health_current.state_occurred_at,device_health_current.state_priority,device_health_current.state_order_key) THEN EXCLUDED.territory_id ELSE device_health_current.territory_id END,
           device_installation_id = CASE WHEN (EXCLUDED.state_occurred_at,EXCLUDED.state_priority,EXCLUDED.state_order_key) >= (device_health_current.state_occurred_at,device_health_current.state_priority,device_health_current.state_order_key) THEN EXCLUDED.device_installation_id ELSE device_health_current.device_installation_id END,
           connection_status = CASE WHEN (EXCLUDED.state_occurred_at,EXCLUDED.state_priority,EXCLUDED.state_order_key) >= (device_health_current.state_occurred_at,device_health_current.state_priority,device_health_current.state_order_key) THEN EXCLUDED.connection_status ELSE device_health_current.connection_status END,
           device_fault = CASE WHEN $18::boolean AND device_health_current.device_fault='reported' THEN device_health_current.device_fault WHEN (EXCLUDED.state_occurred_at,EXCLUDED.state_priority,EXCLUDED.state_order_key) >= (device_health_current.state_occurred_at,device_health_current.state_priority,device_health_current.state_order_key) THEN EXCLUDED.device_fault ELSE device_health_current.device_fault END,
           state_occurred_at = GREATEST(device_health_current.state_occurred_at, EXCLUDED.state_occurred_at),
           state_priority = CASE WHEN (EXCLUDED.state_occurred_at,EXCLUDED.state_priority,EXCLUDED.state_order_key) >= (device_health_current.state_occurred_at,device_health_current.state_priority,device_health_current.state_order_key) THEN EXCLUDED.state_priority ELSE device_health_current.state_priority END,
           state_order_key = CASE WHEN (EXCLUDED.state_occurred_at,EXCLUDED.state_priority,EXCLUDED.state_order_key) >= (device_health_current.state_occurred_at,device_health_current.state_priority,device_health_current.state_order_key) THEN EXCLUDED.state_order_key ELSE device_health_current.state_order_key END,
           fault_code = CASE WHEN $18::boolean AND device_health_current.device_fault='reported' THEN device_health_current.fault_code WHEN (EXCLUDED.state_occurred_at,EXCLUDED.state_priority,EXCLUDED.state_order_key) >= (device_health_current.state_occurred_at,device_health_current.state_priority,device_health_current.state_order_key) THEN EXCLUDED.fault_code ELSE device_health_current.fault_code END,
           power_voltage = CASE WHEN (EXCLUDED.state_occurred_at,EXCLUDED.state_priority,EXCLUDED.state_order_key) >= (device_health_current.state_occurred_at,device_health_current.state_priority,device_health_current.state_order_key) THEN EXCLUDED.power_voltage ELSE device_health_current.power_voltage END,
           signal_strength_dbm = CASE WHEN (EXCLUDED.state_occurred_at,EXCLUDED.state_priority,EXCLUDED.state_order_key) >= (device_health_current.state_occurred_at,device_health_current.state_priority,device_health_current.state_order_key) THEN EXCLUDED.signal_strength_dbm ELSE device_health_current.signal_strength_dbm END,
           provenance = CASE WHEN (EXCLUDED.state_occurred_at,EXCLUDED.state_priority,EXCLUDED.state_order_key) >= (device_health_current.state_occurred_at,device_health_current.state_priority,device_health_current.state_order_key) THEN EXCLUDED.provenance ELSE device_health_current.provenance END,
           data_classification = CASE WHEN (EXCLUDED.state_occurred_at,EXCLUDED.state_priority,EXCLUDED.state_order_key) >= (device_health_current.state_occurred_at,device_health_current.state_priority,device_health_current.state_order_key) THEN EXCLUDED.data_classification ELSE device_health_current.data_classification END,
           -- Numeric observation evidence owns data condition; a later status
           -- packet cannot erase a known stale/unreliable/unknown condition.
           data_condition = device_health_current.data_condition`,
        [
          event.device_id,
          event.organization_id,
          event.territory_id,
          event.device_installation_id,
          event.id,
          event.connection_status,
          event.device_fault,
          event.received_at,
          event.occurred_at,
          statePriority,
          `${event.source_system}:${event.source_event_id}`,
          event.fault_code,
          event.power_voltage,
          event.signal_strength_dbm,
          event.provenance,
          event.data_classification,
          event.data_condition,
          preserveReportedFault,
        ],
      );
      return { event: eventFromRow(event), idempotent: false, liveEventId: journal.rows[0]!.id };
    });
  }
  /** Adapter handoff for clearly marked synthetic simulator status facts. */
  public async ingestSyntheticStatus(
    status: TelemetryStatus,
    expectedTerritoryId?: string,
  ): Promise<{ event: DeviceHealthEvent; idempotent: boolean }> {
    return this.ingest(
      {
        deviceId: status.deviceId,
        sourceSystem: 'synthetic-simulator-v1',
        sourceEventId: status.sourceEventId,
        occurredAt: status.observedAt,
        connectionStatus: status.status === 'offline' ? 'offline' : 'unknown',
        deviceFault: status.status === 'device_fault' ? 'reported' : 'none',
        dataCondition: 'unconfigured',
        faultCode: status.faultCode,
        power: { state: 'unknown' },
        signal: { state: 'unknown' },
        provenance: `synthetic:telemetry-simulator-v1;scenario=${status.scenario}`,
        dataClassification: 'synthetic',
      },
      expectedTerritoryId,
    );
  }
  /**
   * Called from the observation transaction after a durable revision exists.
   * It writes a separate health/journal fact but does not mutate water quality.
   */
  public async ingestAcceptedObservation(observation: Observation): Promise<void> {
    // Revision receipt times describe processing events. Device liveness stays
    // anchored to the original source fact when a later revision is governed.
    const originalReceipt = await this.read(async (client) => {
      const result = await client.query<{ ingested_at: string }>(
        `SELECT to_char(ingested_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') ingested_at
         FROM observation_revisions WHERE lineage_id=$1 AND revision=1`,
        [observation.lineageId],
      );
      return result.rows[0]?.ingested_at ?? null;
    });
    if (!originalReceipt)
      throw new DeviceHealthError('NOT_FOUND', 'The observation source receipt was not found.');
    const dataCondition: DeviceHealthEvent['dataCondition'] = /stale/i.test(
      observation.qualityReason ?? '',
    )
      ? 'stale'
      : observation.qualityState === 'unknown' || observation.qualityState === 'valid'
        ? 'unknown'
        : 'unreliable';
    await this.persist(
      {
        deviceId: observation.deviceId,
        sourceSystem: 'observation-health-v1',
        sourceEventId: `observation:${observation.lineageId}:revision:${observation.revision}`,
        occurredAt: observation.observedAt,
        connectionStatus: 'communicating',
        deviceFault: 'none',
        dataCondition,
        faultCode: null,
        power: { state: 'unknown' },
        signal: { state: 'unknown' },
        provenance: `derived:accepted-observation;revision=${observation.revision}`,
        dataClassification: observation.dataClassification,
      },
      observation.territoryId,
      originalReceipt,
      true,
      1,
      observation.deviceInstallationId,
    );
    // Status occurrence timestamps never populate this field. Only a numeric
    // observation carries a source-time data timestamp, and late facts cannot
    // make it go backwards.
    await this.transaction(async (client) => {
      await client.query(
        `UPDATE device_health_current SET last_observed_at = CASE
           WHEN last_observed_at IS NULL OR last_observed_at < $2::timestamptz THEN $2::timestamptz
           ELSE last_observed_at END,
           data_condition = CASE WHEN last_observed_at IS NULL OR last_observed_at <= $2::timestamptz THEN $3 ELSE data_condition END
         WHERE device_id=$1`,
        [observation.deviceId, observation.observedAt, dataCondition],
      );
    });
  }
  public async current(deviceId: string): Promise<DeviceHealthSnapshot | null> {
    return this.read(async (client) => {
      const result = await client.query<SnapshotRow>(
        `${eventSelect},
        to_char(current.last_seen_received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') last_seen_received_at,
        to_char(current.last_observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') last_observed_at,
        current.data_condition current_data_condition,
        current.connection_status::text current_connection_status, current.device_fault current_device_fault,
        current.fault_code current_fault_code, current.power_voltage::text current_power_voltage,
        current.signal_strength_dbm::text current_signal_strength_dbm, current.provenance current_provenance,
        current.data_classification::text current_classification,
        (SELECT id::text FROM device_live_event_journal journal WHERE journal.health_event_id=event.id) latest_live_event_id
        FROM device_health_current current JOIN device_health_events event ON event.id=current.latest_event_id WHERE current.device_id=$1`,
        [deviceId],
      );
      const row = result.rows[0];
      if (!row) return null;
      const event = eventFromRow({
        ...row,
        received_at: row.last_seen_received_at,
        data_condition: row.current_data_condition,
        connection_status: row.current_connection_status,
        device_fault: row.current_device_fault,
        fault_code: row.current_fault_code,
        power_voltage: row.current_power_voltage,
        signal_strength_dbm: row.current_signal_strength_dbm,
        provenance: row.current_provenance,
        data_classification: row.current_classification,
      });
      return {
        ...projectDeviceHealth(event, row.latest_live_event_id),
        lastObservedAt: row.last_observed_at,
      };
    });
  }
  public async history(
    deviceId: string,
    query: DeviceHealthHistoryQuery,
    territoryIds: readonly string[],
  ): Promise<{ events: DeviceHealthEvent[]; nextCursor: string | null }> {
    const [receivedAt, id] = query.cursor ? decodeHistoryCursor(query.cursor) : [null, null];
    return this.read(async (client) => {
      const rows = (
        await client.query<HealthEventRow>(
          `${eventSelect}
           FROM device_health_events event WHERE event.device_id=$1
             AND event.territory_id = ANY($2::uuid[])
             AND ($3::timestamptz IS NULL OR (event.received_at,event.id) < ($3::timestamptz,$4::uuid))
           ORDER BY event.received_at DESC,event.id DESC LIMIT $5`,
          [deviceId, territoryIds, receivedAt, id, query.limit + 1],
        )
      ).rows;
      const page = rows.slice(0, query.limit);
      return {
        events: page.map(eventFromRow),
        nextCursor: rows.length > query.limit ? encodeHistoryCursor(page[page.length - 1]!) : null,
      };
    });
  }
  public async live(
    organizationId: string,
    afterId: bigint | null,
    limit: number,
    deviceId?: string,
    territoryIds: readonly string[] = [],
  ): Promise<{ reset: boolean; events: Array<{ id: string; event: DeviceHealthEvent }> }> {
    return this.read(async (client) => {
      const bounds = await client.query<{ min_id: string | null; max_id: string | null }>(
        `SELECT min(journal.id)::text min_id,max(journal.id)::text max_id
         FROM device_live_event_journal journal JOIN device_health_events event ON event.id=journal.health_event_id
         WHERE journal.organization_id=$1 AND ($2::uuid IS NULL OR journal.device_id=$2)
           AND event.territory_id = ANY($3::uuid[])`,
        [organizationId, deviceId ?? null, territoryIds],
      );
      const minId = bounds.rows[0]?.min_id === null ? null : BigInt(bounds.rows[0]?.min_id ?? '0');
      const maxId = bounds.rows[0]?.max_id === null ? null : BigInt(bounds.rows[0]?.max_id ?? '0');
      // A durable journal may retain more rows for audit, but replay exposure
      // remains bounded to 500 cursors so a lagging consumer must resync.
      const earliestReplayable =
        minId === null || maxId === null ? null : maxId - 500n > minId ? maxId - 500n : minId;
      const reset =
        afterId !== null && earliestReplayable !== null && afterId < earliestReplayable - 1n;
      const result = await client.query<HealthEventRow & { live_event_id: string }>(
        `${eventSelect}, journal.id::text live_event_id
        FROM device_live_event_journal journal JOIN device_health_events event ON event.id=journal.health_event_id
        WHERE journal.organization_id=$1 AND journal.id > $2::bigint AND ($3::uuid IS NULL OR journal.device_id=$3)
          AND event.territory_id = ANY($4::uuid[])
        ORDER BY journal.id ASC LIMIT $5`,
        [
          organizationId,
          reset ? (maxId?.toString() ?? '0') : (afterId?.toString() ?? '0'),
          deviceId ?? null,
          territoryIds,
          limit,
        ],
      );
      return {
        reset,
        events: result.rows.map((row) => ({ id: row.live_event_id, event: eventFromRow(row) })),
      };
    });
  }
}
