import type {
  CorrectObservationRequest,
  IngestObservationRequest,
  IngestObservationResponse,
  Observation,
  ObservationHistoryQuery,
  ObservationHistoryResponse,
} from '@isuv/contracts';
import type { ObservationIngestionPort } from '@isuv/domain';
import type { PoolClient } from 'pg';
import { withDatabase } from '../../db/client.js';

export class ObservationError extends Error {
  public constructor(
    public readonly kind: 'NOT_FOUND' | 'VALIDATION_ERROR' | 'CONFLICT',
    message: string,
  ) {
    super(message);
  }
}

interface ObservationRow {
  id: string;
  lineage_id: string;
  revision: number;
  organization_id: string;
  territory_id: string;
  sensor_id: string;
  device_id: string;
  device_installation_id: string;
  station_id: string;
  measurement_kind: Observation['measurementKind'];
  source_system: string;
  source_event_id: string;
  observed_at: string;
  ingested_at: Date;
  ingested_cursor: string;
  state: Observation['workflowState'];
  quality_state: Observation['qualityState'];
  quality_reason: string | null;
  value: string;
  unit: Observation['unit'];
  uncertainty: string | null;
  uncertainty_method: string | null;
  uncertainty_confidence: string | null;
  provenance: string;
  data_classification: Observation['dataClassification'];
  correction_reason: string | null;
  totalizer_transition: Observation['totalizerTransition'];
  measurement_method: string | null;
  raw_payload_ref: string | null;
  raw_payload_hash: string | null;
  calibration_ref: string | null;
  rating_curve_ref: string | null;
}

function toObservation(row: ObservationRow): Observation {
  return {
    id: row.id,
    lineageId: row.lineage_id,
    revision: row.revision,
    organizationId: row.organization_id,
    territoryId: row.territory_id,
    stationId: row.station_id,
    sensorId: row.sensor_id,
    deviceId: row.device_id,
    deviceInstallationId: row.device_installation_id,
    measurementKind: row.measurement_kind,
    sourceSystem: row.source_system,
    sourceEventId: row.source_event_id,
    observedAt: row.observed_at,
    // This is also the opaque-cursor timestamp. Do not round server receipt time
    // through JavaScript milliseconds or an as-of read can skip this revision.
    ingestedAt: row.ingested_cursor,
    workflowState: row.state,
    qualityState: row.quality_state,
    qualityReason: row.quality_reason,
    value: row.value,
    unit: row.unit,
    uncertainty: row.uncertainty,
    uncertaintyMethod: row.uncertainty_method,
    uncertaintyConfidence: row.uncertainty_confidence,
    provenance: row.provenance,
    dataClassification: row.data_classification,
    correctionReason: row.correction_reason,
    totalizerTransition: row.totalizer_transition,
    measurementMethod: row.measurement_method,
    rawPayloadRef: row.raw_payload_ref,
    rawPayloadHash: row.raw_payload_hash,
    calibrationRef: row.calibration_ref,
    ratingCurveRef: row.rating_curve_ref,
  };
}

const observationSelect = `
 SELECT revision.id, revision.lineage_id, revision.revision, lineage.organization_id, lineage.territory_id,
        lineage.sensor_id, lineage.device_id, lineage.device_installation_id, lineage.station_id,
        lineage.measurement_kind, lineage.source_system, lineage.source_event_id,
        to_char(lineage.observed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS observed_at,
        revision.ingested_at,
        to_char(revision.ingested_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ingested_cursor,
        revision.state, revision.quality_state, revision.quality_reason, revision.value,
        revision.unit, revision.uncertainty, revision.uncertainty_method, revision.uncertainty_confidence, revision.provenance, revision.data_classification,
        revision.correction_reason, revision.totalizer_transition, revision.measurement_method,
        revision.raw_payload_ref, revision.raw_payload_hash, revision.calibration_ref, revision.rating_curve_ref
 FROM observation_revisions revision JOIN observation_lineages lineage ON lineage.id = revision.lineage_id`;

function equivalentSourcePayload(existing: Observation, input: IngestObservationRequest): boolean {
  return (
    existing.sensorId === input.sensorId &&
    existing.deviceId === input.deviceId &&
    existing.measurementKind === input.measurementKind &&
    existing.sourceSystem === input.sourceSystem &&
    existing.sourceEventId === input.sourceEventId &&
    existing.observedAt === canonicalUtcTimestamp(input.observedAt) &&
    existing.unit === input.unit &&
    existing.value === input.value &&
    existing.qualityState === input.qualityState &&
    existing.qualityReason === input.qualityReason &&
    existing.uncertainty === input.uncertainty &&
    existing.uncertaintyMethod === (input.uncertaintyMethod ?? null) &&
    existing.uncertaintyConfidence === (input.uncertaintyConfidence ?? null) &&
    existing.provenance === input.provenance &&
    existing.totalizerTransition === input.totalizerTransition &&
    existing.measurementMethod === input.measurementMethod &&
    existing.rawPayloadRef === (input.rawPayloadRef ?? null) &&
    existing.rawPayloadHash === (input.rawPayloadHash ?? null) &&
    existing.calibrationRef === (input.calibrationRef ?? null) &&
    existing.ratingCurveRef === (input.ratingCurveRef ?? null)
  );
}

function canonicalUtcTimestamp(value: string): string {
  const fraction = /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/i.exec(value)?.[1] ?? '';
  const wholeSeconds = value.replace(/\.\d+(?=Z|[+-]\d{2}:\d{2}$)/i, '');
  const utcSeconds = new Date(wholeSeconds).toISOString().slice(0, 19);
  return `${utcSeconds}.${`${fraction}000000`.slice(0, 6)}Z`;
}

function encodeCursor(row: ObservationRow): string {
  return Buffer.from(JSON.stringify([row.ingested_cursor, row.revision, row.id])).toString(
    'base64url',
  );
}
function decodeCursor(cursor: string): [string, number, string] {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      !Array.isArray(parsed) ||
      typeof parsed[0] !== 'string' ||
      !Number.isInteger(parsed[1]) ||
      typeof parsed[2] !== 'string' ||
      Number.isNaN(new Date(parsed[0]).getTime())
    )
      throw new Error();
    return [parsed[0], parsed[1], parsed[2]];
  } catch {
    throw new ObservationError('VALIDATION_ERROR', 'The observation cursor is invalid.');
  }
}

export class PostgresObservationService implements ObservationIngestionPort<
  IngestObservationRequest,
  IngestObservationResponse
> {
  public constructor(
    private readonly databaseUrl: string | undefined,
    private readonly transactionClient?: PoolClient,
  ) {}

  private async transaction<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    if (this.transactionClient) {
      await this.transactionClient.query('SAVEPOINT observation_operation');
      try {
        const result = await action(this.transactionClient);
        await this.transactionClient.query('RELEASE SAVEPOINT observation_operation');
        return result;
      } catch (error) {
        await this.transactionClient.query('ROLLBACK TO SAVEPOINT observation_operation');
        await this.transactionClient.query('RELEASE SAVEPOINT observation_operation');
        throw error;
      }
    }
    return withDatabase(this.databaseUrl, async (pool) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await action(client);
        await client.query('COMMIT');
        return result;
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
    return withDatabase(this.databaseUrl, async (pool) => action(pool));
  }

  public async resolveIngestionTerritory(
    sensorId: string,
    deviceId: string,
    observedAt: string,
  ): Promise<string | null> {
    return this.read(
      async (client) =>
        (
          await client.query<{ territory_id: string }>(
            `SELECT installation.territory_id
             FROM telemetry_sensors sensor
             JOIN telemetry_device_installations installation
               ON installation.device_id = sensor.device_id AND installation.organization_id = sensor.organization_id
             WHERE sensor.id = $1 AND sensor.device_id = $2
               AND installation.effective_from <= $3::timestamptz
               AND (installation.effective_until IS NULL OR installation.effective_until > $3::timestamptz)`,
            [sensorId, deviceId, observedAt],
          )
        ).rows[0]?.territory_id ?? null,
    );
  }
  public async findObservationTerritory(lineageId: string): Promise<string | null> {
    return this.read(
      async (client) =>
        (
          await client.query<{ territory_id: string }>(
            'SELECT territory_id FROM observation_lineages WHERE id = $1',
            [lineageId],
          )
        ).rows[0]?.territory_id ?? null,
    );
  }

  /**
   * `expectedTerritoryId` is supplied by the human-facing route after its
   * authorization decision.  Rechecking it in the write statement closes the
   * lookup/write race around effective-dated installations.
   */
  public async ingest(
    input: IngestObservationRequest,
    expectedTerritoryId?: string,
  ): Promise<IngestObservationResponse> {
    try {
      return await this.transaction(async (client) => {
        const created = await client.query<{ id: string }>(
          `INSERT INTO observation_lineages (sensor_id, device_id, device_installation_id, organization_id, territory_id, station_id, measurement_kind, unit, data_classification, source_system, source_event_id, observed_at)
           SELECT sensor.id, sensor.device_id, installation.id, sensor.organization_id, installation.territory_id, installation.station_id, sensor.measurement_kind, sensor.unit, sensor.data_classification, $3, $4, $5
           FROM telemetry_sensors sensor
           JOIN telemetry_device_installations installation
             ON installation.device_id = sensor.device_id AND installation.organization_id = sensor.organization_id
           WHERE sensor.id = $1 AND sensor.device_id = $2 AND sensor.measurement_kind = $6
             AND installation.effective_from <= $5::timestamptz
             AND (installation.effective_until IS NULL OR installation.effective_until > $5::timestamptz)
             AND ($7::uuid IS NULL OR installation.territory_id = $7::uuid)
           ON CONFLICT (organization_id, source_system, source_event_id) DO NOTHING RETURNING id`,
          [
            input.sensorId,
            input.deviceId,
            input.sourceSystem,
            input.sourceEventId,
            input.observedAt,
            input.measurementKind,
            expectedTerritoryId ?? null,
          ],
        );
        if (!created.rows[0]) {
          const existing = await client.query<ObservationRow>(
            `${observationSelect}
            WHERE lineage.organization_id = (SELECT organization_id FROM telemetry_sensors WHERE id = $1)
              AND lineage.source_system = $2 AND lineage.source_event_id = $3 AND revision.revision = 1`,
            [input.sensorId, input.sourceSystem, input.sourceEventId],
          );
          if (!existing.rows[0])
            throw new ObservationError(
              'VALIDATION_ERROR',
              'The sensor or its provenance is invalid.',
            );
          const observation = toObservation(existing.rows[0]);
          if (expectedTerritoryId && observation.territoryId !== expectedTerritoryId)
            throw new ObservationError('NOT_FOUND', 'The observation was not found.');
          if (!equivalentSourcePayload(observation, input))
            throw new ObservationError(
              'CONFLICT',
              'Source event identity was reused with a different payload.',
            );
          return { observation, idempotent: true };
        }
        const lineageId = created.rows[0].id;
        const lineage = await client.query<{
          data_classification: Observation['dataClassification'];
        }>('SELECT data_classification FROM observation_lineages WHERE id = $1', [lineageId]);
        const revision = await client.query<{ id: string }>(
          `INSERT INTO observation_revisions (lineage_id, revision, state, quality_state, quality_reason, value, unit, uncertainty, uncertainty_method, uncertainty_confidence, provenance, data_classification, totalizer_transition, measurement_method, raw_payload_ref, raw_payload_hash, calibration_ref, rating_curve_ref)
           VALUES ($1,1,'raw',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
          [
            lineageId,
            input.qualityState,
            input.qualityReason,
            input.value,
            input.unit,
            input.uncertainty,
            input.uncertaintyMethod ?? null,
            input.uncertaintyConfidence ?? null,
            input.provenance,
            lineage.rows[0]?.data_classification,
            input.totalizerTransition,
            input.measurementMethod,
            input.rawPayloadRef ?? null,
            input.rawPayloadHash ?? null,
            input.calibrationRef ?? null,
            input.ratingCurveRef ?? null,
          ],
        );
        const inserted = await client.query<ObservationRow>(
          `${observationSelect} WHERE revision.id = $1`,
          [revision.rows[0]?.id],
        );
        return { observation: toObservation(inserted.rows[0]!), idempotent: false };
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23514')
        throw new ObservationError('VALIDATION_ERROR', 'The observation is invalid.');
      throw error;
    }
  }

  public async correct(
    lineageId: string,
    input: CorrectObservationRequest,
    actorUserId: string,
    requestId: string,
  ): Promise<Observation> {
    try {
      return await this.transaction(async (client) => {
        const current = await client.query<ObservationRow>(
          `${observationSelect} WHERE lineage.id = $1 ORDER BY revision.revision DESC, revision.id DESC LIMIT 1 FOR UPDATE`,
          [lineageId],
        );
        const existing = current.rows[0];
        if (!existing) throw new ObservationError('NOT_FOUND', 'The observation was not found.');
        const revision = await client.query<{ id: string }>(
          `INSERT INTO observation_revisions (lineage_id, revision, state, quality_state, quality_reason, value, unit, uncertainty, uncertainty_method, uncertainty_confidence, provenance, data_classification, correction_reason, totalizer_transition, measurement_method, raw_payload_ref, raw_payload_hash, calibration_ref, rating_curve_ref)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
          [
            lineageId,
            existing.revision + 1,
            input.workflowState,
            input.qualityState,
            input.qualityReason,
            input.value,
            existing.unit,
            input.uncertainty,
            input.uncertainty === null
              ? null
              : (input.uncertaintyMethod ?? existing.uncertainty_method),
            input.uncertainty === null
              ? null
              : (input.uncertaintyConfidence ?? existing.uncertainty_confidence),
            input.provenance,
            existing.data_classification,
            input.correctionReason,
            input.totalizerTransition,
            input.measurementMethod ?? existing.measurement_method,
            existing.raw_payload_ref,
            existing.raw_payload_hash,
            input.calibrationRef ?? existing.calibration_ref,
            input.ratingCurveRef ?? existing.rating_curve_ref,
          ],
        );
        const inserted = await client.query<ObservationRow>(
          `${observationSelect} WHERE revision.id = $1`,
          [revision.rows[0]?.id],
        );
        const observation = toObservation(inserted.rows[0]!);
        const action =
          input.workflowState === 'rejected'
            ? 'observation.rejected'
            : input.workflowState === 'estimated'
              ? 'observation.estimated'
              : 'observation.corrected';
        const audit = await client.query(
          `INSERT INTO audit_events (organization_id, territory_id, actor_user_id, actor_organization_id, action, resource, resource_id, old_state, new_state, reason, request_id, data_classification, provenance)
           SELECT $1,$2,actor.id,actor.organization_id,$3::audit_event_action,'observation',$4,$5::jsonb,$6::jsonb,$7,$8,$9,'observation_correction_api'
           FROM identity_users actor
           WHERE actor.id = $10 AND actor.is_active = true`,
          [
            existing.organization_id,
            existing.territory_id,
            action,
            observation.id,
            JSON.stringify(toObservation(existing)),
            JSON.stringify(observation),
            input.correctionReason,
            requestId,
            existing.data_classification,
            actorUserId,
          ],
        );
        if (audit.rowCount !== 1)
          throw new ObservationError('NOT_FOUND', 'The observation was not found.');
        return observation;
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23514')
        throw new ObservationError('VALIDATION_ERROR', 'The correction is invalid.');
      throw error;
    }
  }

  public async find(lineageId: string, asOf?: Date | string): Promise<Observation | null> {
    return this.read(async (client) => {
      const result = await client.query<ObservationRow>(
        `${observationSelect}
        WHERE lineage.id=$1 AND ($2::timestamptz IS NULL OR revision.ingested_at <= $2)
        ORDER BY revision.ingested_at DESC, revision.revision DESC, revision.id DESC LIMIT 1`,
        [lineageId, asOf ?? null],
      );
      return result.rows[0] ? toObservation(result.rows[0]) : null;
    });
  }

  public async history(
    lineageId: string,
    query: ObservationHistoryQuery,
  ): Promise<ObservationHistoryResponse> {
    return this.read(async (client) => {
      const cursor = query.cursor ? decodeCursor(query.cursor) : null;
      const result = await client.query<ObservationRow>(
        `${observationSelect}
        WHERE lineage.id=$1 AND ($2::timestamptz IS NULL OR (revision.ingested_at, revision.revision, revision.id) < ($2::timestamptz,$3::int,$4::uuid))
        ORDER BY revision.ingested_at DESC, revision.revision DESC, revision.id DESC LIMIT $5`,
        [lineageId, cursor?.[0] ?? null, cursor?.[1] ?? null, cursor?.[2] ?? null, query.limit + 1],
      );
      const resultPage = result.rows.slice(0, query.limit);
      const rows = resultPage.map(toObservation);
      return {
        observations: rows,
        nextCursor: result.rows.length > query.limit ? encodeCursor(resultPage.at(-1)!) : null,
      };
    });
  }
}
