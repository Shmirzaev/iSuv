import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { Pool } from 'pg';
import { PostgresObservationService } from '../observations/service.js';
import { PostgresAlarmRuleService } from './service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const pool = new Pool({ connectionString: databaseUrl });
after(async () => pool.end());

test('governed exact rule persistence is idempotent and late invalid evidence never rewrites active history', async () => {
  const client = await pool.connect();
  await client.query('BEGIN');
  try {
    const fixture = (
      await client.query<{
        organization_id: string;
        territory_id: string;
        sensor_id: string;
        device_id: string;
      }>(
        `SELECT sensor.organization_id,sensor.territory_id,sensor.id sensor_id,sensor.device_id
         FROM telemetry_sensors sensor
         JOIN telemetry_device_installations installation ON installation.device_id=sensor.device_id
         WHERE sensor.measurement_kind='stage' AND sensor.unit='m'
           AND sensor.territory_id='a2000000-0000-4000-8000-000000000004'
           AND sensor.lifecycle='active' AND installation.effective_until IS NULL
         ORDER BY sensor.id LIMIT 1`,
      )
    ).rows[0]!;
    const requester = 'a3000000-0000-4000-8000-000000000005';
    const approver = 'a3000000-0000-4000-8000-000000000006';
    const rules = new PostgresAlarmRuleService(databaseUrl, client);
    const observations = new PostgresObservationService(databaseUrl, client);
    const rule = await rules.create(
      {
        territoryId: fixture.territory_id,
        subjectKind: 'observation_sensor',
        subjectId: fixture.sensor_id,
        provenance: 'synthetic:alarm-rule-db-test',
        reason: 'create exact stage condition test',
      },
      requester,
      'alarm-rule-create',
    );
    const unconfigured = await rules.evaluate(rule.id, {
      effectiveAt: '2030-01-01T00:00:00.000000Z',
      knownAt: '2025-01-01T00:00:00.000000Z',
    });
    assert.equal(unconfigured.state, 'deferred');
    assert.equal(unconfigured.reason, 'unconfigured_rule');
    assert.deepEqual(
      await rules.evaluate(rule.id, {
        effectiveAt: '2030-01-01T00:00:00.000000Z',
        knownAt: '2025-01-01T00:00:00.000000Z',
      }),
      unconfigured,
    );
    const requested = await rules.request(
      rule.id,
      {
        effectiveFrom: '2030-01-01T00:00:00.000000Z',
        effectiveUntil: '2030-01-02T00:00:00.000000Z',
        condition: {
          kind: 'observation_threshold',
          sensorId: fixture.sensor_id,
          quantity: 'stage',
          unit: 'm',
          direction: 'high',
          enter: '10',
          clear: '8',
          enterPersistenceMicroseconds: '10',
          clearPersistenceMicroseconds: '10',
          maxGapMicroseconds: '20',
          uncertaintyBound: '0.1',
          rateGate: null,
        },
        provenance: 'synthetic:alarm-rule-db-test',
        reason: 'request exact stage condition test',
      },
      requester,
      'alarm-rule-request',
    );
    await client.query('SAVEPOINT alarm_self_approval');
    await assert.rejects(
      rules.approve(rule.id, requested.version, 'self approval', requester, 'alarm-self'),
      /invalid|approval/i,
    );
    await client.query('ROLLBACK TO SAVEPOINT alarm_self_approval');
    await rules.approve(
      rule.id,
      requested.version,
      'independent hydrology approval',
      approver,
      'alarm-rule-approve',
    );

    async function stage(observedAt: string, value: string, valid: boolean) {
      const ingested = await observations.ingest({
        sensorId: fixture.sensor_id,
        deviceId: fixture.device_id,
        measurementKind: 'stage',
        sourceSystem: 'alarm-rule-db-test',
        sourceEventId: randomUUID(),
        observedAt,
        unit: 'm',
        value,
        uncertainty: '0',
        uncertaintyMethod: 'synthetic_exact_fixture',
        uncertaintyConfidence: '1',
        qualityState: valid ? 'unknown' : 'invalid',
        qualityReason: valid ? 'awaiting governed correction' : 'synthetic invalid spike',
        totalizerTransition: null,
        provenance: 'synthetic:alarm-rule-db-test',
        measurementMethod: 'synthetic_direct_stage_fixture',
      });
      if (!valid) return ingested.observation;
      return observations.correct(
        ingested.observation.lineageId,
        {
          workflowState: 'corrected',
          value,
          uncertainty: '0',
          qualityState: 'valid',
          qualityReason: null,
          totalizerTransition: null,
          provenance: 'synthetic:governed-alarm-rule-db-test',
          correctionReason: 'governed exact rule fixture',
          measurementMethod: 'synthetic_direct_stage_fixture',
        },
        approver,
        `alarm-observation-${randomUUID()}`,
      );
    }

    const first = await stage('2030-01-01T00:00:00.000000Z', '11', true);
    const pending = await rules.evaluate(rule.id, {
      effectiveAt: '2030-01-01T00:00:00.000000Z',
      knownAt: first.ingestedAt,
    });
    assert.equal(pending.state, 'pending_activation');
    await rules.evaluate(rule.id, {
      effectiveAt: '2030-01-01T00:00:00.000000Z',
      knownAt: first.ingestedAt,
    });
    const second = await stage('2030-01-01T00:00:00.000010Z', '11', true);
    const active = await rules.evaluate(rule.id, {
      effectiveAt: '2030-01-01T00:00:00.000010Z',
      knownAt: second.ingestedAt,
    });
    assert.equal(active.state, 'active');
    assert.equal(active.qualifyingFactCount, 2);
    assert.equal(active.qualifyingDurationMicroseconds, '10');

    const invalidLate = await stage('2030-01-01T00:00:00.000005Z', '57', false);
    const recalculated = await rules.evaluate(rule.id, {
      effectiveAt: '2030-01-01T00:00:00.000010Z',
      knownAt: invalidLate.ingestedAt,
    });
    assert.equal(recalculated.state, 'deferred');
    assert.equal(recalculated.reason, 'untrusted_fact');

    const runs = await client.query<{ state: string; count: string }>(
      `SELECT state,count(*)::text count FROM alarm_rule_evaluation_runs
       WHERE rule_id=$1 GROUP BY state ORDER BY state`,
      [rule.id],
    );
    assert.deepEqual(runs.rows, [
      { state: 'active', count: '1' },
      { state: 'deferred', count: '2' },
      { state: 'pending_activation', count: '1' },
    ]);
    const projection = (
      await client.query<{ state: string }>(
        'SELECT state FROM alarm_rule_current_signals WHERE rule_id=$1',
        [rule.id],
      )
    ).rows[0]!;
    assert.equal(projection.state, 'deferred');
    const expectedRebuilt = Number(
      (
        await client.query<{ count: string }>(
          'SELECT count(*)::text count FROM alarm_rule_current_signals',
        )
      ).rows[0]!.count,
    );
    assert.equal(
      Number(
        (
          await client.query<{ rebuilt: string }>(
            'SELECT rebuild_alarm_rule_current_signals() rebuilt',
          )
        ).rows[0]!.rebuilt,
      ),
      expectedRebuilt,
    );

    await client.query('SAVEPOINT invalid_alarm_projection');
    await assert.rejects(
      client.query("UPDATE alarm_rule_current_signals SET state='active' WHERE rule_id=$1", [
        rule.id,
      ]),
      /projection is inconsistent/i,
    );
    await client.query('ROLLBACK TO SAVEPOINT invalid_alarm_projection');

    await client.query('SAVEPOINT forged_alarm_version');
    await assert.rejects(
      client.query(
        `INSERT INTO alarm_rule_versions(
          rule_id,version,status,effective_from,effective_until,condition,provenance,
          requested_by_user_id,request_reason,requested_request_id,approval_reason
        ) VALUES($1,2,'requested','2030-01-03Z','2030-01-04Z',$2,'synthetic:forged',$3,'forged','forged','forged approval')`,
        [
          rule.id,
          {
            kind: 'observation_threshold',
            sensorId: fixture.sensor_id,
            quantity: 'stage',
            unit: 'm',
            direction: 'high',
            enter: '10',
            clear: '8',
            enterPersistenceMicroseconds: '10',
            clearPersistenceMicroseconds: '10',
            maxGapMicroseconds: '20',
            uncertaintyBound: '0.1',
            rateGate: null,
          },
          requester,
        ],
      ),
      /check constraint|violates check/i,
    );
    await client.query('ROLLBACK TO SAVEPOINT forged_alarm_version');

    const runId = (
      await client.query<{ id: string }>(
        'SELECT id FROM alarm_rule_evaluation_runs WHERE rule_id=$1 LIMIT 1',
        [rule.id],
      )
    ).rows[0]!.id;
    await client.query('SAVEPOINT forged_alarm_evaluation');
    await assert.rejects(
      client.query(
        `INSERT INTO alarm_rule_evaluation_runs(
          rule_id,rule_version_id,effective_at,known_at,input_fingerprint,
          algorithm_version,state,reason,result,evidence,evidence_count,data_classification
        ) SELECT rule_id,rule_version_id,effective_at,known_at + interval '1 microsecond',
          input_fingerprint,algorithm_version,state,reason,result,evidence,evidence_count,
          data_classification
        FROM alarm_rule_evaluation_runs WHERE id=$1`,
        [runId],
      ),
      /snapshot is invalid/i,
    );
    await client.query('ROLLBACK TO SAVEPOINT forged_alarm_evaluation');
    await client.query('SAVEPOINT immutable_alarm_evaluation');
    await assert.rejects(
      client.query("UPDATE alarm_rule_evaluation_runs SET state='inactive' WHERE id=$1", [runId]),
      /immutable/i,
    );
    await client.query('ROLLBACK TO SAVEPOINT immutable_alarm_evaluation');

    const audits = await client.query<{ action: string; old_state: unknown }>(
      `SELECT action::text,old_state FROM audit_events
       WHERE resource_id IN ($1,$2)`,
      [rule.id, requested.id],
    );
    assert.deepEqual(audits.rows.map((row) => row.action).sort(), [
      'alarm_rule.created',
      'alarm_rule_version.approved',
      'alarm_rule_version.requested',
    ]);
    assert.notEqual(
      audits.rows.find((row) => row.action === 'alarm_rule_version.approved')?.old_state,
      null,
    );
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});
