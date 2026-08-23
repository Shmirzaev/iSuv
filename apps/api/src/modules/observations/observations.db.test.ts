import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { Pool } from 'pg';
import { PostgresObservationService } from './service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for database integration tests');
const pool = new Pool({ connectionString: databaseUrl, max: 2 });

after(async () => pool.end());

async function removeTestLineage(lineageId: string): Promise<void> {
  // Test-owned rows are removed with trigger replication disabled; production roles
  // retain append-only triggers and this helper is never reachable by application code.
  await pool.query('BEGIN');
  try {
    await pool.query('SET LOCAL session_replication_role = replica');
    await pool.query(
      `DELETE FROM audit_events WHERE resource = 'observation'
       AND resource_id IN (SELECT id FROM observation_revisions WHERE lineage_id = $1)`,
      [lineageId],
    );
    await pool.query('DELETE FROM observation_revisions WHERE lineage_id = $1', [lineageId]);
    await pool.query('DELETE FROM observation_lineages WHERE id = $1', [lineageId]);
    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
}

test(
  'observation lineage is immutable, idempotent by canonical payload, and corrections are audited',
  { concurrency: false },
  async () => {
    const client = await pool.connect();
    await client.query('BEGIN');
    try {
      const fixture = await client.query<{
        sensor_id: string;
        device_id: string;
        installation_id: string;
        actor_id: string;
      }>(
        `SELECT sensor.id sensor_id, sensor.device_id, installation.id installation_id,
              (SELECT id FROM identity_users WHERE organization_id = sensor.organization_id AND is_active = true ORDER BY id LIMIT 1) actor_id
       FROM telemetry_sensors sensor JOIN telemetry_device_installations installation ON installation.device_id = sensor.device_id
       WHERE sensor.measurement_kind = 'stage' AND installation.effective_until IS NULL LIMIT 1`,
      );
      const row = fixture.rows[0]!;
      const service = new PostgresObservationService(databaseUrl, client);
      const sourceEventId = randomUUID();
      const payload = {
        sensorId: row.sensor_id,
        deviceId: row.device_id,
        measurementKind: 'stage' as const,
        sourceSystem: 'db-test-adapter',
        sourceEventId,
        observedAt: new Date().toISOString().replace(/(\.\d{3})Z$/, '$1456Z'),
        unit: 'm' as const,
        value: '12.3400',
        uncertainty: null,
        qualityState: 'unknown' as const,
        qualityReason: 'awaiting automated validation',
        totalizerTransition: null,
        provenance: 'synthetic-db-test',
        measurementMethod: 'unconfigured',
        rawPayloadRef: null,
        rawPayloadHash: null,
        calibrationRef: null,
        ratingCurveRef: null,
      };
      const first = await service.ingest(payload);
      assert.equal(first.idempotent, false);
      assert.equal(first.observation.value, '12.3400');
      assert.equal(first.observation.observedAt, payload.observedAt);
      const duplicate = await service.ingest(payload);
      assert.equal(duplicate.idempotent, true);
      const unauthorizedTerritory = await client.query<{ id: string }>(
        'SELECT id FROM territories WHERE organization_id = $1 AND id <> $2 ORDER BY id LIMIT 1',
        [first.observation.organizationId, first.observation.territoryId],
      );
      const racedSourceEventId = randomUUID();
      await assert.rejects(
        service.ingest(
          { ...payload, sourceEventId: racedSourceEventId },
          unauthorizedTerritory.rows[0]?.id,
        ),
      );
      const racedWrite = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM observation_lineages WHERE source_event_id = $1',
        [racedSourceEventId],
      );
      assert.equal(racedWrite.rows[0]?.count, '0');
      await assert.rejects(service.ingest({ ...payload, value: '13.0000' }), /reused/);
      await assert.rejects(
        service.ingest({
          ...payload,
          observedAt: payload.observedAt.replace('456Z', '999Z'),
        }),
        /reused/,
      );
      await assert.rejects(
        service.ingest({
          ...payload,
          sourceEventId: randomUUID(),
          qualityState: 'estimated',
          qualityReason: 'raw estimates are not permitted',
        }),
      );
      const correction = await service.correct(
        first.observation.lineageId,
        {
          workflowState: 'corrected',
          value: '12.4400',
          uncertainty: null,
          uncertaintyMethod: undefined,
          uncertaintyConfidence: undefined,
          qualityState: 'valid',
          qualityReason: null,
          totalizerTransition: null,
          provenance: 'synthetic-db-correction',
          correctionReason: 'verified field note',
          measurementMethod: undefined,
          calibrationRef: undefined,
          ratingCurveRef: undefined,
        },
        row.actor_id,
        'observation-db-request',
      );
      assert.equal(correction.revision, 2);
      const current = await service.find(first.observation.lineageId);
      assert.equal(current?.id, correction.id);

      const totalizerFixture = await client.query<{ sensor_id: string; device_id: string }>(
        `SELECT sensor.id sensor_id, sensor.device_id
         FROM telemetry_sensors sensor
         JOIN telemetry_device_installations installation ON installation.device_id = sensor.device_id
         WHERE sensor.measurement_kind = 'accumulated_volume' AND installation.effective_until IS NULL LIMIT 1`,
      );
      const counter = totalizerFixture.rows[0]!;
      const counterTime = new Date().toISOString().replace(/(\.\d{3})Z$/, '$1456Z');
      const total = await service.ingest({
        sensorId: counter.sensor_id,
        deviceId: counter.device_id,
        measurementKind: 'accumulated_volume',
        sourceSystem: 'db-test-adapter',
        sourceEventId: randomUUID(),
        observedAt: counterTime,
        unit: 'm3',
        value: '100.000',
        uncertainty: null,
        qualityState: 'unknown',
        qualityReason: 'raw counter reading',
        totalizerTransition: 'normal',
        provenance: 'synthetic-db-test',
        measurementMethod: 'unconfigured',
      });
      const reset = await service.ingest({
        sensorId: counter.sensor_id,
        deviceId: counter.device_id,
        measurementKind: 'accumulated_volume',
        sourceSystem: 'db-test-adapter',
        sourceEventId: randomUUID(),
        observedAt: counterTime.replace('456Z', '999Z'),
        unit: 'm3',
        value: '2.000',
        uncertainty: null,
        qualityState: 'suspect',
        qualityReason: 'device reset reported',
        totalizerTransition: 'reset_reported',
        provenance: 'synthetic-db-test',
        measurementMethod: 'unconfigured',
      });
      assert.equal(total.observation.unit, 'm3');
      assert.equal(total.observation.workflowState, 'raw');
      assert.equal(reset.observation.totalizerTransition, 'reset_reported');
      assert.equal('intervalVolume' in reset.observation, false);

      const relocation = await client.query<{
        sensor_id: string;
        device_id: string;
        installation_id: string;
        territory_id: string;
        new_station_id: string;
        new_territory_id: string;
      }>(
        `SELECT sensor.id sensor_id, sensor.device_id, installation.id installation_id,
                installation.territory_id, replacement.id new_station_id, replacement.territory_id new_territory_id
         FROM telemetry_sensors sensor
         JOIN telemetry_device_installations installation ON installation.device_id = sensor.device_id
         JOIN monitoring_stations replacement ON replacement.organization_id = sensor.organization_id
           AND replacement.territory_id <> installation.territory_id AND replacement.data_classification = installation.data_classification
         WHERE sensor.measurement_kind = 'stage' AND installation.effective_until IS NULL LIMIT 1`,
      );
      const move = relocation.rows[0]!;
      const cutover = new Date(Date.now() - 60_000).toISOString();
      const oldObservedAt = new Date(Date.now() - 120_000).toISOString();
      await client.query(
        'UPDATE telemetry_device_installations SET effective_until = $1 WHERE id = $2',
        [cutover, move.installation_id],
      );
      await client.query(
        `INSERT INTO telemetry_device_installations (organization_id, territory_id, device_id, station_id, effective_from, provenance, data_classification)
         SELECT organization_id, $1, device_id, $2, $3, 'synthetic relocation test', data_classification
         FROM telemetry_device_installations WHERE id = $4`,
        [move.new_territory_id, move.new_station_id, cutover, move.installation_id],
      );
      assert.equal(
        await service.resolveIngestionTerritory(move.sensor_id, move.device_id, oldObservedAt),
        move.territory_id,
      );
      assert.equal(
        await service.resolveIngestionTerritory(
          move.sensor_id,
          move.device_id,
          new Date().toISOString(),
        ),
        move.new_territory_id,
      );
      assert.equal(
        await service.resolveIngestionTerritory(
          move.sensor_id,
          move.device_id,
          '1900-01-01T00:00:00.000Z',
        ),
        null,
      );
      const delayed = await service.ingest({
        sensorId: move.sensor_id,
        deviceId: move.device_id,
        measurementKind: 'stage',
        sourceSystem: 'db-test-relocation',
        sourceEventId: randomUUID(),
        observedAt: oldObservedAt,
        unit: 'm',
        value: '4.200',
        uncertainty: null,
        qualityState: 'unknown',
        qualityReason: 'delayed raw event',
        totalizerTransition: null,
        provenance: 'synthetic-db-test',
        measurementMethod: 'unconfigured',
      });
      assert.equal(delayed.observation.territoryId, move.territory_id);
      assert.equal(delayed.observation.stationId === move.new_station_id, false);
      const history = await service.history(first.observation.lineageId, { limit: 1 });
      assert.equal(history.observations.length, 1);
      assert.ok(history.nextCursor);
      assert.equal(history.observations[0]?.id, correction.id);
      const nextHistory = await service.history(first.observation.lineageId, {
        limit: 1,
        cursor: history.nextCursor!,
      });
      assert.deepEqual(
        nextHistory.observations.map((item) => item.id),
        [first.observation.id],
      );
      assert.equal(nextHistory.nextCursor, null);
      const asOfCurrent = await service.find(first.observation.lineageId, correction.ingestedAt);
      assert.equal(asOfCurrent?.id, correction.id);
      const asOfOriginal = await service.find(
        first.observation.lineageId,
        first.observation.ingestedAt,
      );
      assert.equal(asOfOriginal?.id, first.observation.id);
      const audit = await client.query<{
        resource_id: string;
        request_id: string;
        action: string;
        reason: string;
        old_state: { value: string };
        new_state: { value: string };
        occurred_at: Date;
      }>(
        'SELECT resource_id, request_id, action::text, reason, old_state, new_state, occurred_at FROM audit_events WHERE resource_id = $1',
        [correction.id],
      );
      assert.deepEqual(
        { resource_id: audit.rows[0]?.resource_id, request_id: audit.rows[0]?.request_id },
        {
          resource_id: correction.id,
          request_id: 'observation-db-request',
        },
      );
      assert.equal(audit.rows[0]?.action, 'observation.corrected');
      assert.equal(audit.rows[0]?.reason, 'verified field note');
      assert.equal(audit.rows[0]?.old_state.value, '12.3400');
      assert.equal(audit.rows[0]?.new_state.value, '12.4400');
      assert.ok(audit.rows[0]?.occurred_at instanceof Date);
      await client.query('SAVEPOINT immutable');
      await assert.rejects(
        client.query('UPDATE observation_revisions SET value = 0 WHERE id = $1', [
          first.observation.id,
        ]),
      );
      await client.query('ROLLBACK TO SAVEPOINT immutable');
      await client.query('RELEASE SAVEPOINT immutable');
      await client.query('SAVEPOINT append_only');
      await assert.rejects(
        client.query('DELETE FROM observation_revisions WHERE id = $1', [correction.id]),
      );
      await client.query('ROLLBACK TO SAVEPOINT append_only');
      await client.query('RELEASE SAVEPOINT append_only');
      await client.query('SAVEPOINT append_only_lineage');
      await assert.rejects(
        client.query('DELETE FROM observation_lineages WHERE id = $1', [
          first.observation.lineageId,
        ]),
      );
      await client.query('ROLLBACK TO SAVEPOINT append_only_lineage');
      await client.query('RELEASE SAVEPOINT append_only_lineage');
      const originals = await client.query<{ value: string }>(
        'SELECT value::text FROM observation_revisions WHERE id = $1',
        [first.observation.id],
      );
      assert.equal(originals.rows[0]?.value, '12.3400');
      await client.query('SAVEPOINT wrong_kind');
      await assert.rejects(
        client.query(
          `INSERT INTO observation_lineages (organization_id, territory_id, sensor_id, device_id, device_installation_id, station_id, measurement_kind, unit, data_classification, source_system, source_event_id, observed_at)
           SELECT sensor.organization_id, sensor.territory_id, sensor.id, sensor.device_id, installation.id, installation.station_id, 'discharge', 'm3/s', sensor.data_classification, 'db-test', $1, now()
           FROM telemetry_sensors sensor JOIN telemetry_device_installations installation ON installation.device_id = sensor.device_id
           WHERE sensor.id = $2 LIMIT 1`,
          [randomUUID(), row.sensor_id],
        ),
      );
      await client.query('ROLLBACK TO SAVEPOINT wrong_kind');
      await client.query('RELEASE SAVEPOINT wrong_kind');
      await client.query('SAVEPOINT wrong_installation_time');
      await assert.rejects(
        client.query(
          `INSERT INTO observation_lineages (organization_id, territory_id, sensor_id, device_id, device_installation_id, station_id, measurement_kind, unit, data_classification, source_system, source_event_id, observed_at)
           SELECT sensor.organization_id, sensor.territory_id, sensor.id, sensor.device_id, installation.id, installation.station_id, sensor.measurement_kind, sensor.unit, sensor.data_classification, 'db-test', $1, '1900-01-01T00:00:00.000Z'
           FROM telemetry_sensors sensor JOIN telemetry_device_installations installation ON installation.id = $2
           WHERE sensor.id = $3`,
          [randomUUID(), row.installation_id, row.sensor_id],
        ),
      );
      await client.query('ROLLBACK TO SAVEPOINT wrong_installation_time');
      await client.query('RELEASE SAVEPOINT wrong_installation_time');
      await client.query('SAVEPOINT noninitial_raw');
      await assert.rejects(
        client.query(
          `INSERT INTO observation_revisions (lineage_id, revision, state, quality_state, quality_reason, value, unit, uncertainty, provenance, data_classification, correction_reason, totalizer_transition, measurement_method, raw_payload_ref, raw_payload_hash, calibration_ref, rating_curve_ref)
           SELECT lineage_id, 3, 'raw', quality_state, quality_reason, value, unit, uncertainty, provenance, data_classification, correction_reason, totalizer_transition, measurement_method, raw_payload_ref, raw_payload_hash, calibration_ref, rating_curve_ref
           FROM observation_revisions WHERE id = $1`,
          [correction.id],
        ),
      );
      await client.query('ROLLBACK TO SAVEPOINT noninitial_raw');
      await client.query('RELEASE SAVEPOINT noninitial_raw');
      const crossOrganizationId = randomUUID();
      const crossActorId = randomUUID();
      await client.query(
        `INSERT INTO organizations (id, code, name, data_classification)
         VALUES ($1, $2, 'Cross organization audit actor', 'synthetic')`,
        [crossOrganizationId, `OBS-CROSS-${randomUUID()}`],
      );
      await client.query(
        `INSERT INTO identity_users (id, organization_id, external_subject, display_name, data_classification)
         VALUES ($1, $2, $3, 'System observation administrator', 'synthetic')`,
        [crossActorId, crossOrganizationId, `synthetic:cross-actor:${randomUUID()}`],
      );
      await client.query(
        `INSERT INTO user_role_grants (user_id, organization_id, role, scope, effective_from)
         VALUES ($1, $2, 'system_admin', 'system', now() - interval '1 minute')`,
        [crossActorId, crossOrganizationId],
      );
      assert.notEqual(crossOrganizationId, first.observation.organizationId);
      const crossOrganizationCorrection = await service.correct(
        first.observation.lineageId,
        {
          workflowState: 'corrected',
          value: '12.4500',
          uncertainty: null,
          qualityState: 'valid',
          qualityReason: null,
          totalizerTransition: null,
          provenance: 'synthetic-db-correction',
          correctionReason: 'authorized system scope correction',
          measurementMethod: undefined,
          calibrationRef: undefined,
          ratingCurveRef: undefined,
        },
        crossActorId,
        'observation-cross-organization-actor',
      );
      const crossOrganizationAudit = await client.query<{
        organization_id: string;
        actor_organization_id: string;
      }>('SELECT organization_id, actor_organization_id FROM audit_events WHERE resource_id = $1', [
        crossOrganizationCorrection.id,
      ]);
      assert.deepEqual(crossOrganizationAudit.rows[0], {
        organization_id: first.observation.organizationId,
        actor_organization_id: crossOrganizationId,
      });
      await client.query('UPDATE identity_users SET is_active = false WHERE id = $1', [
        crossActorId,
      ]);
      await assert.rejects(
        service.correct(
          first.observation.lineageId,
          {
            workflowState: 'corrected',
            value: '12.4500',
            uncertainty: null,
            qualityState: 'valid',
            qualityReason: null,
            totalizerTransition: null,
            provenance: 'synthetic-db-correction',
            correctionReason: 'inactive actor must roll back',
            measurementMethod: undefined,
            calibrationRef: undefined,
            ratingCurveRef: undefined,
          },
          crossActorId,
          'observation-inactive-actor',
        ),
      );
      const revisionsAfterInactiveActor = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM observation_revisions WHERE lineage_id = $1',
        [first.observation.lineageId],
      );
      assert.equal(revisionsAfterInactiveActor.rows[0]?.count, '3');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  },
);

test(
  'concurrent source delivery has one base revision and conflicting microseconds are not idempotent',
  { concurrency: false },
  async () => {
    const fixture = await pool.query<{ sensor_id: string; device_id: string }>(
      `SELECT sensor.id sensor_id, sensor.device_id
     FROM telemetry_sensors sensor JOIN telemetry_device_installations installation ON installation.device_id = sensor.device_id
     WHERE sensor.measurement_kind = 'stage' AND installation.effective_until IS NULL LIMIT 1`,
    );
    const row = fixture.rows[0]!;
    const sourceEventId = randomUUID();
    const payload = {
      sensorId: row.sensor_id,
      deviceId: row.device_id,
      measurementKind: 'stage' as const,
      sourceSystem: 'concurrency-test-adapter',
      sourceEventId,
      observedAt: new Date().toISOString().replace(/(\.\d{3})Z$/, '$1456Z'),
      unit: 'm' as const,
      value: '7.100',
      uncertainty: null,
      qualityState: 'unknown' as const,
      qualityReason: 'raw concurrent delivery',
      totalizerTransition: null,
      provenance: 'synthetic-db-test',
      measurementMethod: 'unconfigured',
    };
    const left = new PostgresObservationService(databaseUrl);
    const right = new PostgresObservationService(databaseUrl);
    let lineageId: string | undefined;
    try {
      const results = await Promise.all([left.ingest(payload), right.ingest(payload)]);
      lineageId = results[0].observation.lineageId;
      assert.equal(results.filter((result) => !result.idempotent).length, 1);
      assert.equal(new Set(results.map((result) => result.observation.id)).size, 1);
      const count = await pool.query<{ revisions: string }>(
        'SELECT count(*)::text revisions FROM observation_revisions WHERE lineage_id = $1',
        [lineageId],
      );
      assert.equal(count.rows[0]?.revisions, '1');
      await assert.rejects(
        right.ingest({ ...payload, observedAt: payload.observedAt.replace('456Z', '457Z') }),
        /reused/,
      );
    } finally {
      if (lineageId) await removeTestLineage(lineageId);
    }
  },
);

test(
  'concurrent human corrections serialize as a linear revision history',
  { concurrency: false },
  async () => {
    const fixture = await pool.query<{ sensor_id: string; device_id: string; actor_id: string }>(
      `SELECT sensor.id sensor_id, sensor.device_id,
            (SELECT id FROM identity_users WHERE organization_id = sensor.organization_id AND is_active = true ORDER BY id LIMIT 1) actor_id
     FROM telemetry_sensors sensor JOIN telemetry_device_installations installation ON installation.device_id = sensor.device_id
     WHERE sensor.measurement_kind = 'stage' AND installation.effective_until IS NULL LIMIT 1`,
    );
    const row = fixture.rows[0]!;
    const sourceEventId = randomUUID();
    const payload = {
      sensorId: row.sensor_id,
      deviceId: row.device_id,
      measurementKind: 'stage' as const,
      sourceSystem: 'correction-concurrency-adapter',
      sourceEventId,
      observedAt: new Date().toISOString(),
      unit: 'm' as const,
      value: '8.000',
      uncertainty: null,
      qualityState: 'unknown' as const,
      qualityReason: 'raw pending review',
      totalizerTransition: null,
      provenance: 'synthetic-db-test',
      measurementMethod: 'unconfigured',
    };
    const created = await new PostgresObservationService(databaseUrl).ingest(payload);
    try {
      const correction = (value: string, reason: string) =>
        new PostgresObservationService(databaseUrl).correct(
          created.observation.lineageId,
          {
            workflowState: 'corrected',
            value,
            uncertainty: null,
            qualityState: 'valid',
            qualityReason: null,
            totalizerTransition: null,
            provenance: 'synthetic-review',
            correctionReason: reason,
          },
          row.actor_id,
          `concurrent-${reason}`,
        );
      const outcomes = await Promise.allSettled([
        correction('8.100', 'review A'),
        correction('8.200', 'review B'),
      ]);
      assert.equal(
        outcomes.every((outcome) => outcome.status === 'fulfilled'),
        true,
      );
      const revisions = await pool.query<{ revision: number }>(
        'SELECT revision FROM observation_revisions WHERE lineage_id = $1 ORDER BY revision',
        [created.observation.lineageId],
      );
      assert.deepEqual(
        revisions.rows.map((item) => item.revision),
        [1, 2, 3],
      );
      const audits = await pool.query<{ count: string }>(
        `SELECT count(*)::text count FROM audit_events
         WHERE action = 'observation.corrected'
           AND resource_id IN (SELECT id FROM observation_revisions WHERE lineage_id = $1)`,
        [created.observation.lineageId],
      );
      assert.equal(audits.rows[0]?.count, '2');
    } finally {
      await removeTestLineage(created.observation.lineageId);
    }
  },
);
