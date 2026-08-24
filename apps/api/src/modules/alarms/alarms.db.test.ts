import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { Pool } from 'pg';
import { PostgresAlarmRuleService } from '../alarm-rules/service.js';
import { PostgresObservationService } from '../observations/service.js';
import { PostgresAlarmService } from './service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const pool = new Pool({ connectionString: databaseUrl });
after(async () => pool.end());

test('canonical catalog and governed active signals create one synthetic alarm while deferred evidence preserves it', async () => {
  const client = await pool.connect();
  await client.query('BEGIN');
  try {
    const codes = (
      await client.query<{ code: string }>(
        'SELECT code FROM alarm_catalog_event_types ORDER BY code',
      )
    ).rows.map((row) => row.code);
    assert.deepEqual(codes, [
      'calibration_overdue',
      'communication_loss',
      'dry_canal',
      'high_stage',
      'network_inconsistency',
      'over_allocation',
      'power_problem',
      'sensor_frozen',
      'sensor_impossible',
      'sudden_flow_change',
      'under_allocation',
      'unexplained_balance',
    ]);
    const fixture = (
      await client.query<{
        territory_id: string;
        sensor_id: string;
        device_id: string;
      }>(
        `SELECT sensor.territory_id,sensor.id sensor_id,sensor.device_id
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
    const alarms = new PostgresAlarmService(databaseUrl, client);
    const observations = new PostgresObservationService(databaseUrl, client);
    const rule = await rules.create(
      {
        territoryId: fixture.territory_id,
        subjectKind: 'observation_sensor',
        subjectId: fixture.sensor_id,
        provenance: 'synthetic:alarm-db-test',
        reason: 'dry-canal alarm fixture',
      },
      requester,
      'alarm-db-rule-create',
    );
    await rules.evaluate(rule.id, {
      effectiveAt: '2030-01-01T00:00:00.000000Z',
      knownAt: '2025-01-01T00:00:00.000000Z',
    });
    const ruleVersion = await rules.request(
      rule.id,
      {
        effectiveFrom: '2030-01-01T00:00:00.000000Z',
        effectiveUntil: '2030-01-02T00:00:00.000000Z',
        condition: {
          kind: 'observation_threshold',
          sensorId: fixture.sensor_id,
          quantity: 'stage',
          unit: 'm',
          direction: 'low',
          enter: '8',
          clear: '10',
          enterPersistenceMicroseconds: '10',
          clearPersistenceMicroseconds: '10',
          maxGapMicroseconds: '20',
          uncertaintyBound: '0.1',
          rateGate: null,
        },
        provenance: 'synthetic:alarm-db-test',
        reason: 'dry-canal exact persistence',
      },
      requester,
      'alarm-db-rule-request',
    );
    await rules.approve(
      rule.id,
      ruleVersion.version,
      'independent rule approval',
      approver,
      'alarm-db-rule-approve',
    );
    const catalog = await alarms.create(
      {
        territoryId: fixture.territory_id,
        eventType: 'dry_canal',
        title: 'Synthetic dry-canal warning',
        provenance: 'synthetic:alarm-db-test',
        reason: 'catalog test fixture',
      },
      requester,
      'alarm-db-catalog-create',
    );
    const catalogVersion = await alarms.requestVersion(
      catalog.id,
      {
        effectiveFrom: '2030-01-01T00:00:00.000000Z',
        effectiveUntil: '2030-01-01T00:00:00.000060Z',
        ruleId: rule.id,
        activationSupport: 'p4_001_rule_signal',
        waterCondition: 'dry_canal',
        systemDeviceCondition: 'not_assessed',
        severity: 'warning',
        provenance: 'synthetic:alarm-db-test',
        reason: 'bind dry-canal signal',
      },
      requester,
      'alarm-db-catalog-request',
    );
    await client.query('SAVEPOINT catalog_self_approval');
    await assert.rejects(
      alarms.approveVersion(catalog.id, catalogVersion.version, 'self', requester, 'catalog-self'),
      /invalid|approval/i,
    );
    await client.query('ROLLBACK TO SAVEPOINT catalog_self_approval');
    await alarms.approveVersion(
      catalog.id,
      catalogVersion.version,
      'independent catalog approval',
      approver,
      'alarm-db-catalog-approve',
    );

    async function stage(observedAt: string, value: string, valid: boolean) {
      const ingested = await observations.ingest({
        sensorId: fixture.sensor_id,
        deviceId: fixture.device_id,
        measurementKind: 'stage',
        sourceSystem: 'alarm-db-test',
        sourceEventId: randomUUID(),
        observedAt,
        unit: 'm',
        value,
        uncertainty: '0',
        uncertaintyMethod: 'synthetic_exact_fixture',
        uncertaintyConfidence: '1',
        qualityState: valid ? 'unknown' : 'invalid',
        qualityReason: valid ? 'awaiting correction' : 'invalid synthetic spike',
        totalizerTransition: null,
        provenance: 'synthetic:alarm-db-test',
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
          provenance: 'synthetic:alarm-db-test',
          correctionReason: 'governed alarm fixture',
          measurementMethod: 'synthetic_direct_stage_fixture',
        },
        approver,
        `alarm-db-observation-${randomUUID()}`,
      );
    }

    await stage('2030-01-01T00:00:00.000000Z', '7', true);
    const second = await stage('2030-01-01T00:00:00.000010Z', '7', true);
    const created = await alarms.materialize(
      rule.id,
      '2030-01-01T00:00:00.000010Z',
      second.ingestedAt,
      requester,
      'alarm-db-materialize',
    );
    assert.equal(created.outcome, 'created');
    assert.equal(created.alarm?.severity, 'warning');
    assert.equal(created.alarm?.waterCondition, 'dry_canal');
    assert.equal(created.alarm?.systemDeviceCondition, 'not_assessed');
    assert.equal(created.alarm?.officialComplianceEligible, false);
    const replay = await alarms.materialize(
      rule.id,
      '2030-01-01T00:00:00.000010Z',
      second.ingestedAt,
      requester,
      'alarm-db-materialize-replay',
    );
    assert.equal(replay.outcome, 'existing');
    assert.equal(replay.alarm?.id, created.alarm?.id);

    await stage('2030-01-01T00:00:00.000020Z', '11', true);
    const clearFact = await stage('2030-01-01T00:00:00.000030Z', '11', true);
    const cleared = await alarms.materialize(
      rule.id,
      '2030-01-01T00:00:00.000030Z',
      clearFact.ingestedAt,
      requester,
      'alarm-db-auto-clear',
    );
    assert.equal(cleared.outcome, 'existing');
    assert.equal(cleared.action, 'automatically_cleared');
    assert.equal(cleared.alarm?.automaticState, 'cleared');

    await stage('2030-01-01T00:00:00.000040Z', '7', true);
    const reactivationFact = await stage('2030-01-01T00:00:00.000050Z', '7', true);
    const recurrence = await alarms.materialize(
      rule.id,
      '2030-01-01T00:00:00.000050Z',
      reactivationFact.ingestedAt,
      requester,
      'alarm-db-reactivation',
    );
    assert.equal(recurrence.outcome, 'created');
    assert.notEqual(recurrence.alarm?.id, created.alarm?.id);

    await stage('2030-01-01T00:00:00.000060Z', '7', true);
    const outsideCatalogFact = await stage('2030-01-01T00:00:00.000070Z', '7', true);
    await rules.evaluate(rule.id, {
      effectiveAt: '2030-01-01T00:00:00.000070Z',
      knownAt: outsideCatalogFact.ingestedAt,
    });
    const outsideCatalogRun = (
      await client.query<{
        id: string;
        effective_at: string;
        known_at: string;
        qualifying_start: string;
      }>(
        `SELECT id,effective_at,known_at,result->>'qualifyingStart' qualifying_start
         FROM alarm_rule_evaluation_runs WHERE rule_id=$1 AND effective_at=$2 AND known_at=$3`,
        [rule.id, '2030-01-01T00:00:00.000070Z', outsideCatalogFact.ingestedAt],
      )
    ).rows[0]!;
    await client.query('SAVEPOINT expired_catalog_alarm');
    await assert.rejects(
      client.query(
        `INSERT INTO alarms(organization_id,territory_id,catalog_id,catalog_version_id,
          rule_id,rule_version_id,event_type,water_condition,system_condition,severity,
          activation_signal_run_id,activation_episode_start,activated_effective_at,
          activated_known_at,materialized_by_user_id,materialized_request_id,provenance)
         SELECT organization_id,territory_id,catalog_id,catalog_version_id,rule_id,rule_version_id,
          event_type,water_condition,system_condition,severity,$2,$3,$4,$5,$6,$7,provenance
         FROM alarms WHERE id=$1`,
        [
          recurrence.alarm!.id,
          outsideCatalogRun.id,
          outsideCatalogRun.qualifying_start,
          outsideCatalogRun.effective_at,
          outsideCatalogRun.known_at,
          requester,
          'forged-expired-catalog-alarm',
        ],
      ),
      /materialization snapshot is invalid/i,
    );
    await client.query('ROLLBACK TO SAVEPOINT expired_catalog_alarm');

    const invalid = await stage('2030-01-01T00:00:00.000045Z', '57', false);
    const preserved = await alarms.materialize(
      rule.id,
      '2030-01-01T00:00:00.000050Z',
      invalid.ingestedAt,
      requester,
      'alarm-db-materialize-invalid',
    );
    assert.equal(preserved.outcome, 'existing');
    assert.equal(preserved.action, 'preserved_unassessable');
    assert.equal(preserved.alarm?.automaticState, 'active');
    assert.equal(
      Number(
        (
          await client.query<{ count: string }>(
            'SELECT count(*)::text count FROM alarms WHERE rule_id=$1',
            [rule.id],
          )
        ).rows[0]!.count,
      ),
      2,
    );
    assert.equal(
      Number(
        (
          await client.query<{ count: string }>(
            'SELECT count(*)::text count FROM alarm_evidence WHERE alarm_id=$1',
            [recurrence.alarm!.id],
          )
        ).rows[0]!.count,
      ),
      2,
    );
    assert.equal(
      (
        await client.query<{ evidence_status: string }>(
          'SELECT evidence_status FROM alarm_evidence WHERE alarm_id=$1 ORDER BY known_at DESC LIMIT 1',
          [recurrence.alarm!.id],
        )
      ).rows[0]!.evidence_status,
      'unassessable',
    );

    const unconfiguredRun = (
      await client.query<{
        id: string;
        effective_at: string;
        known_at: string;
        result: unknown;
        evidence: unknown;
      }>(
        `SELECT id,effective_at,known_at,result,evidence FROM alarm_rule_evaluation_runs
         WHERE rule_id=$1 AND rule_version_id IS NULL LIMIT 1`,
        [rule.id],
      )
    ).rows[0]!;
    await client.query('SAVEPOINT wrong_rule_version_evidence');
    await assert.rejects(
      client.query(
        `INSERT INTO alarm_evidence(alarm_id,signal_run_id,effective_at,known_at,
          evidence_status,result,evidence,provenance)
         VALUES($1,$2,$3,$4,'unassessable',$5,$6,'synthetic:forged')`,
        [
          recurrence.alarm!.id,
          unconfiguredRun.id,
          unconfiguredRun.effective_at,
          unconfiguredRun.known_at,
          unconfiguredRun.result,
          unconfiguredRun.evidence,
        ],
      ),
      /evidence snapshot is invalid/i,
    );
    await client.query('ROLLBACK TO SAVEPOINT wrong_rule_version_evidence');

    await client.query(
      `INSERT INTO user_role_grants(id,user_id,organization_id,role,scope,territory_id,
        effective_from,cancelled_at)
       VALUES($1,'a3000000-0000-4000-8000-000000000008','a1000000-0000-4000-8000-000000000001',
        'district_operator','territory',$2,'2031-01-01T00:00:00Z','2030-01-01T00:00:00Z')`,
      [randomUUID(), fixture.territory_id],
    );
    assert.equal(
      (
        await client.query<{ allowed: boolean }>(
          `SELECT alarm_catalog_actor_may_act(
            'a3000000-0000-4000-8000-000000000008',$1,$2,'write','2032-01-01T00:00:00Z'
          ) allowed`,
          ['a1000000-0000-4000-8000-000000000001', fixture.territory_id],
        )
      ).rows[0]!.allowed,
      false,
    );

    await client.query('SAVEPOINT forged_alarm_update');
    await assert.rejects(
      client.query("UPDATE alarms SET severity='critical' WHERE id=$1", [created.alarm!.id]),
      /immutable|automatic clear/i,
    );
    await client.query('ROLLBACK TO SAVEPOINT forged_alarm_update');
    const auditActions = (
      await client.query<{ action: string }>(
        `SELECT action::text FROM audit_events WHERE resource_id IN($1,$2,$3,$4) ORDER BY action`,
        [catalog.id, catalogVersion.id, created.alarm!.id, recurrence.alarm!.id],
      )
    ).rows
      .map((row) => row.action)
      .sort();
    assert.deepEqual(auditActions, [
      'alarm.cleared',
      'alarm.created',
      'alarm.created',
      'alarm_catalog.created',
      'alarm_catalog_policy.approved',
      'alarm_catalog_policy.requested',
    ]);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});
