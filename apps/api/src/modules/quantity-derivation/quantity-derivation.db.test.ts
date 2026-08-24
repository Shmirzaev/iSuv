import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { Pool } from 'pg';
import { PostgresObservationService } from '../observations/service.js';
import { PostgresQuantityDerivationService } from './service.js';
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for database integration tests');
const pool = new Pool({ connectionString: databaseUrl });
after(async () => pool.end());
test(
  'synthetic quantity models are immutable, ordered, non-overlapping, and selected as-of known time',
  { concurrency: false },
  async () => {
    const client = await pool.connect();
    await client.query('BEGIN');
    try {
      const seeded = (
        await client.query<{
          curve_id: string;
          id: string;
          station_id: string;
          approved_at: string;
        }>(
          `SELECT version.curve_id,version.id,curve.station_id,to_char(version.approved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') approved_at FROM rating_curve_versions version JOIN rating_curves curve ON curve.id=version.curve_id ORDER BY version.id LIMIT 1`,
        )
      ).rows[0]!;
      const service = new PostgresQuantityDerivationService(databaseUrl, client);
      const beforeKnown = (
        await client.query<{ known_at: string }>(
          `SELECT to_char((approved_at - interval '1 microsecond') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') known_at FROM rating_curve_versions WHERE id=$1`,
          [seeded.id],
        )
      ).rows[0]!.known_at;
      assert.equal(
        await service.findRatingCurve(seeded.curve_id, '2026-02-01T00:00:00.000000Z', beforeKnown),
        null,
      );
      const found = await service.findRatingCurve(
        seeded.curve_id,
        '2026-02-01T00:00:00.000000Z',
        seeded.approved_at,
      );
      assert.ok(found);
      assert.equal(found!.dataClassification, 'synthetic');
      assert.equal(found!.officialComplianceEligible, false);
      const auditBefore = (
        await client.query<{ count: string }>(
          "SELECT count(*)::text count FROM audit_events WHERE resource='quantity_model'",
        )
      ).rows[0]!.count;
      await client.query('SAVEPOINT bad_knots');
      await assert.rejects(
        client.query(
          `INSERT INTO rating_curve_versions(curve_id,version,effective_from,knots,requested_by_user_id,request_reason,requested_request_id,approved_by_user_id,approval_reason,approved_request_id) VALUES($1,2,'2030-01-01T00:00:00Z','[{"stageM":"1","dischargeM3s":"2"},{"stageM":"1","dischargeM3s":"3"}]','a3000000-0000-4000-8000-000000000001','test request','test-request','a3000000-0000-4000-8000-000000000002','test approval','test-approval')`,
          [seeded.curve_id],
        ),
        /strictly ascend/i,
      );
      await client.query('ROLLBACK TO SAVEPOINT bad_knots');
      await client.query('SAVEPOINT unauthorized_requester');
      await assert.rejects(
        client.query(
          `INSERT INTO rating_curve_versions(curve_id,version,effective_from,knots,requested_by_user_id,request_reason,requested_request_id,approved_by_user_id,approval_reason,approved_request_id) VALUES($1,2,'2030-01-01T00:00:00Z','[{"stageM":"0","dischargeM3s":"0"},{"stageM":"1","dischargeM3s":"1"}]','a3000000-0000-4000-8000-000000000005','test request','test-request','a3000000-0000-4000-8000-000000000002','test approval','test-approval')`,
          [seeded.curve_id],
        ),
        /not authorized/i,
      );
      await client.query('ROLLBACK TO SAVEPOINT unauthorized_requester');
      await client.query('SAVEPOINT self_approval');
      await assert.rejects(
        client.query(
          `INSERT INTO rating_curve_versions(curve_id,version,effective_from,knots,requested_by_user_id,request_reason,requested_request_id,approved_by_user_id,approval_reason,approved_request_id) VALUES($1,2,'2030-01-01T00:00:00Z','[{"stageM":"0","dischargeM3s":"0"},{"stageM":"1","dischargeM3s":"1"}]','a3000000-0000-4000-8000-000000000001','test request','test-request','a3000000-0000-4000-8000-000000000001','test approval','test-approval')`,
          [seeded.curve_id],
        ),
        /governance|check/i,
      );
      await client.query('ROLLBACK TO SAVEPOINT self_approval');
      await client.query('SAVEPOINT official');
      await assert.rejects(
        client.query(
          `INSERT INTO rating_curves(organization_id,territory_id,station_id,stage_sensor_id,device_installation_id,data_classification,provenance,created_by_user_id,creation_reason,created_request_id) SELECT organization_id,territory_id,station_id,stage_sensor_id,device_installation_id,'official','bypass','a3000000-0000-4000-8000-000000000001','test','quantity-official-bypass' FROM rating_curves WHERE id=$1`,
          [seeded.curve_id],
        ),
        /synthetic/i,
      );
      await client.query('ROLLBACK TO SAVEPOINT official');
      await client.query('SAVEPOINT mutable');
      await assert.rejects(
        client.query('UPDATE rating_curve_versions SET knots=knots WHERE id=$1', [seeded.id]),
        /immutable/i,
      );
      await client.query('ROLLBACK TO SAVEPOINT mutable');
      await client.query('SAVEPOINT overlap');
      await assert.rejects(
        client.query(
          `INSERT INTO rating_curve_versions(curve_id,version,effective_from,knots,requested_by_user_id,request_reason,requested_request_id,approved_by_user_id,approval_reason,approved_request_id) VALUES($1,2,'2026-06-01T00:00:00Z','[{"stageM":"0","dischargeM3s":"0"},{"stageM":"1","dischargeM3s":"1"}]','a3000000-0000-4000-8000-000000000001','test request','test-request','a3000000-0000-4000-8000-000000000002','test approval','test-approval')`,
          [seeded.curve_id],
        ),
        /conflict|exclude/i,
      );
      await client.query('ROLLBACK TO SAVEPOINT overlap');
      const policy = (
        await client.query<{ id: string }>(
          `SELECT id FROM integration_coverage_policy_versions ORDER BY id LIMIT 1`,
        )
      ).rows[0]!;
      await client.query('SAVEPOINT policy_mutation');
      await assert.rejects(
        client.query(
          'UPDATE integration_coverage_policy_versions SET max_gap_microseconds=1 WHERE id=$1',
          [policy.id],
        ),
        /immutable/i,
      );
      await client.query('ROLLBACK TO SAVEPOINT policy_mutation');
      const auditAfter = (
        await client.query<{ count: string }>(
          "SELECT count(*)::text count FROM audit_events WHERE resource='quantity_model'",
        )
      ).rows[0]!.count;
      assert.equal(
        auditAfter,
        auditBefore,
        'rejected direct DML must not leave partial audit events',
      );
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  },
);

test(
  'database derivation selects governed revisions as-of known time and preserves exact units',
  { concurrency: false },
  async () => {
    const client = await pool.connect();
    await client.query('BEGIN');
    try {
      const fixtures = await client.query<{
        method: 'direct_discharge' | 'stage_rating_curve' | 'accumulated_volume_delta';
        station_id: string;
        sensor_id: string;
        device_id: string;
      }>(
        `SELECT policy.method,policy.station_id,policy.sensor_id,sensor.device_id
         FROM integration_coverage_policies policy
         JOIN telemetry_sensors sensor ON sensor.id=policy.sensor_id
         WHERE policy.id IN (
           'b9000000-0000-4000-8000-000000000003',
           'b9000000-0000-4000-8000-000000000005',
           'b9000000-0000-4000-8000-000000000007'
         )
         ORDER BY policy.method`,
      );
      assert.equal(fixtures.rows.length, 3);
      const observations = new PostgresObservationService(databaseUrl, client);
      const quantity = new PostgresQuantityDerivationService(databaseUrl, client);
      const actorId = 'a3000000-0000-4000-8000-000000000001';
      const ingestValidated = async (
        fixture: (typeof fixtures.rows)[number],
        observedAt: string,
        value: string,
        totalizerTransition:
          'normal' | 'reset_reported' | 'rollover_reported' | 'unknown' = 'normal',
      ) => {
        const measurementKind =
          fixture.method === 'direct_discharge'
            ? 'discharge'
            : fixture.method === 'stage_rating_curve'
              ? 'stage'
              : 'accumulated_volume';
        const unit =
          fixture.method === 'direct_discharge'
            ? 'm3/s'
            : fixture.method === 'stage_rating_curve'
              ? 'm'
              : 'm3';
        const counterTransition =
          fixture.method === 'accumulated_volume_delta' ? totalizerTransition : null;
        const sourceEventId = randomUUID();
        const raw = await observations.ingest({
          sensorId: fixture.sensor_id,
          deviceId: fixture.device_id,
          measurementKind,
          sourceSystem: 'quantity-derivation-db-test',
          sourceEventId,
          observedAt,
          unit,
          value,
          uncertainty: null,
          qualityState: 'unknown',
          qualityReason: 'awaiting governed test validation',
          totalizerTransition: counterTransition,
          provenance: 'synthetic:quantity-derivation-db-test',
          measurementMethod: `synthetic_${measurementKind}_fixture`,
          rawPayloadRef: null,
          rawPayloadHash: null,
          calibrationRef: null,
          ratingCurveRef: null,
        });
        const corrected = await observations.correct(
          raw.observation.lineageId,
          {
            workflowState: 'corrected',
            value,
            uncertainty: null,
            qualityState: 'valid',
            qualityReason: null,
            totalizerTransition: counterTransition,
            provenance: 'synthetic:governed-quantity-derivation-db-test',
            correctionReason: 'validated synthetic quantity fixture',
            measurementMethod: `synthetic_${measurementKind}_fixture`,
          },
          actorId,
          `quantity-derivation-${sourceEventId}`,
        );
        return { raw: raw.observation, corrected };
      };

      const direct = fixtures.rows.find((row) => row.method === 'direct_discharge')!;
      const stage = fixtures.rows.find((row) => row.method === 'stage_rating_curve')!;
      const counter = fixtures.rows.find((row) => row.method === 'accumulated_volume_delta')!;
      const directStart = '2026-02-01T00:00:00.000001Z';
      const directEnd = '2026-02-01T00:00:01.000002Z';
      await ingestValidated(direct, directStart, '1');
      const directLast = await ingestValidated(direct, directEnd, '3');
      const historicalCutoff = (
        await client.query<{ cutoff: string }>(
          `SELECT to_char(($1::timestamptz - interval '1 microsecond') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cutoff`,
          [directLast.corrected.ingestedAt],
        )
      ).rows[0]!.cutoff;
      const historical = await quantity.derive(direct.station_id, {
        sensorId: direct.sensor_id,
        method: 'direct_discharge',
        intervalStart: directStart,
        intervalEnd: directEnd,
        knownAt: historicalCutoff,
      });
      assert.equal(historical.outcome, 'deferred');
      assert.equal(historical.deferReason, 'unusable_observation');

      const computed = await quantity.derive(direct.station_id, {
        sensorId: direct.sensor_id,
        method: 'direct_discharge',
        intervalStart: directStart,
        intervalEnd: directEnd,
        knownAt: directLast.corrected.ingestedAt,
      });
      assert.equal(computed.outcome, 'computed');
      if (computed.outcome === 'computed') {
        assert.deepEqual(computed.volume, {
          numerator: '1000001',
          denominator: '500000',
          unit: 'm3',
        });
        assert.equal(computed.qualityState, 'valid');
        assert.equal(computed.sourceRefs.length, 2);
        assert.ok(computed.sourceRefs.every((source) => source.workflowState === 'corrected'));
      }
      const explicitlyWrongStream = await quantity.derive(direct.station_id, {
        sensorId: stage.sensor_id,
        method: 'direct_discharge',
        intervalStart: directStart,
        intervalEnd: directEnd,
        knownAt: directLast.corrected.ingestedAt,
      });
      assert.equal(explicitlyWrongStream.outcome, 'deferred');
      assert.equal(explicitlyWrongStream.deferReason, 'no_approved_coverage_policy');

      const stageStart = '2026-02-01T00:01:00.000000Z';
      const stageEnd = '2026-02-01T00:01:01.000000Z';
      await ingestValidated(stage, stageStart, '0');
      const stageLast = await ingestValidated(stage, stageEnd, '2');
      const estimated = await quantity.derive(stage.station_id, {
        sensorId: stage.sensor_id,
        method: 'stage_rating_curve',
        intervalStart: stageStart,
        intervalEnd: stageEnd,
        knownAt: stageLast.corrected.ingestedAt,
      });
      assert.equal(estimated.outcome, 'computed');
      if (estimated.outcome === 'computed') {
        assert.deepEqual(estimated.volume, { numerator: '5', denominator: '2', unit: 'm3' });
        assert.equal(estimated.qualityState, 'estimated');
        assert.ok(estimated.curveVersionId);
        assert.equal(estimated.dataClassification, 'synthetic');
        assert.equal(estimated.officialComplianceEligible, false);
      }
      const counterStart = '2026-02-01T00:02:00.000000Z';
      const counterEnd = '2026-02-01T00:02:01.000000Z';
      await ingestValidated(counter, counterStart, '100.25');
      const counterLast = await ingestValidated(counter, counterEnd, '103.75');
      const delta = await quantity.derive(counter.station_id, {
        sensorId: counter.sensor_id,
        method: 'accumulated_volume_delta',
        intervalStart: counterStart,
        intervalEnd: counterEnd,
        knownAt: counterLast.corrected.ingestedAt,
      });
      assert.equal(delta.outcome, 'computed');
      if (delta.outcome === 'computed') {
        assert.deepEqual(delta.volume, { numerator: '7', denominator: '2', unit: 'm3' });
        assert.equal(delta.qualityState, 'valid');
        assert.equal(delta.curveVersionId, null);
        assert.ok(delta.sourceRefs.every((source) => source.totalizerTransition === 'normal'));
        assert.equal(delta.dataClassification, 'synthetic');
        assert.equal(delta.officialComplianceEligible, false);
      }
      const resetStart = '2026-02-01T00:03:00.000000Z';
      const resetEnd = '2026-02-01T00:03:01.000000Z';
      await ingestValidated(counter, resetStart, '200');
      const resetLast = await ingestValidated(counter, resetEnd, '10', 'reset_reported');
      const reset = await quantity.derive(counter.station_id, {
        sensorId: counter.sensor_id,
        method: 'accumulated_volume_delta',
        intervalStart: resetStart,
        intervalEnd: resetEnd,
        knownAt: resetLast.corrected.ingestedAt,
      });
      assert.equal(reset.outcome, 'deferred');
      assert.equal(reset.deferReason, 'counter_reset_or_rollover');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  },
);
