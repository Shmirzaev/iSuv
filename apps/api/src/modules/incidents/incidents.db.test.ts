import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { Pool } from 'pg';
import { PostgresAlarmRuleService } from '../alarm-rules/service.js';
import { PostgresAlarmService } from '../alarms/service.js';
import { PostgresObservationService } from '../observations/service.js';
import { IncidentError, PostgresIncidentService } from './service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const pool = new Pool({ connectionString: databaseUrl });
after(async () => pool.end());

test('governed incident workflow snapshots policy, serializes alarm ownership, and requires automatic clear', async () => {
  const fixture = (
    await pool.query<{ territory_id: string; sensor_id: string; device_id: string }>(
      `SELECT sensor.territory_id,sensor.id sensor_id,sensor.device_id
       FROM telemetry_sensors sensor
       JOIN telemetry_device_installations installation ON installation.device_id=sensor.device_id
       WHERE sensor.measurement_kind='stage' AND sensor.unit='m'
         AND sensor.territory_id='a2000000-0000-4000-8000-000000000004'
         AND sensor.lifecycle='active' AND installation.effective_until IS NULL
       ORDER BY sensor.id LIMIT 1`,
    )
  ).rows[0]!;
  const operator = 'a3000000-0000-4000-8000-000000000005';
  const hydrologist = 'a3000000-0000-4000-8000-000000000006';
  const director = 'a3000000-0000-4000-8000-000000000003';
  const maintainer = 'a3000000-0000-4000-8000-000000000007';
  const auditor = 'a3000000-0000-4000-8000-000000000008';
  const rules = new PostgresAlarmRuleService(databaseUrl);
  const alarms = new PostgresAlarmService(databaseUrl);
  const observations = new PostgresObservationService(databaseUrl);
  const incidents = new PostgresIncidentService(databaseUrl);

  const rule = await rules.create(
    {
      territoryId: fixture.territory_id,
      subjectKind: 'observation_sensor',
      subjectId: fixture.sensor_id,
      provenance: 'synthetic:incident-db-test',
      reason: 'incident high-stage source fixture',
    },
    operator,
    'incident-rule-create',
  );
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
      provenance: 'synthetic:incident-db-test',
      reason: 'exact synthetic persistence',
    },
    operator,
    'incident-rule-request',
  );
  await rules.approve(
    rule.id,
    ruleVersion.version,
    'independent source approval',
    hydrologist,
    'incident-rule-approve',
  );
  const catalog = await alarms.create(
    {
      territoryId: fixture.territory_id,
      eventType: 'dry_canal',
      title: 'Synthetic incident dry-canal warning',
      provenance: 'synthetic:incident-db-test',
      reason: 'incident catalog fixture',
    },
    operator,
    'incident-catalog-create',
  );
  const catalogVersion = await alarms.requestVersion(
    catalog.id,
    {
      effectiveFrom: '2030-01-01T00:00:00.000000Z',
      effectiveUntil: '2030-01-02T00:00:00.000000Z',
      ruleId: rule.id,
      activationSupport: 'p4_001_rule_signal',
      waterCondition: 'dry_canal',
      systemDeviceCondition: 'not_assessed',
      severity: 'warning',
      provenance: 'synthetic:incident-db-test',
      reason: 'bind incident source',
    },
    operator,
    'incident-catalog-request',
  );
  await alarms.approveVersion(
    catalog.id,
    catalogVersion.version,
    'independent catalog approval',
    hydrologist,
    'incident-catalog-approve',
  );

  async function stage(observedAt: string, value: string) {
    const raw = await observations.ingest({
      sensorId: fixture.sensor_id,
      deviceId: fixture.device_id,
      measurementKind: 'stage',
      sourceSystem: 'incident-db-test',
      sourceEventId: randomUUID(),
      observedAt,
      unit: 'm',
      value,
      uncertainty: '0',
      uncertaintyMethod: 'synthetic_exact_fixture',
      uncertaintyConfidence: '1',
      qualityState: 'unknown',
      qualityReason: 'awaiting governed correction',
      totalizerTransition: null,
      provenance: 'synthetic:incident-db-test',
      measurementMethod: 'synthetic_direct_stage_fixture',
    });
    return observations.correct(
      raw.observation.lineageId,
      {
        workflowState: 'corrected',
        value,
        uncertainty: '0',
        qualityState: 'valid',
        qualityReason: null,
        totalizerTransition: null,
        provenance: 'synthetic:incident-db-test',
        correctionReason: 'govern incident source fact',
        measurementMethod: 'synthetic_direct_stage_fixture',
      },
      hydrologist,
      `incident-observation-${randomUUID()}`,
    );
  }

  await stage('2030-01-01T00:00:00.000000Z', '7');
  const activationFact = await stage('2030-01-01T00:00:00.000010Z', '7');
  const activation = await alarms.materialize(
    rule.id,
    '2030-01-01T00:00:00.000010Z',
    activationFact.ingestedAt,
    operator,
    'incident-alarm-materialize',
  );
  assert.equal(activation.outcome, 'created');
  const alarmId = activation.alarm!.id;

  const policy = await incidents.createPolicy(
    {
      territoryId: fixture.territory_id,
      eventType: 'dry_canal',
      severity: 'warning',
      title: 'Synthetic warning response targets',
      provenance: 'synthetic:incident-db-test',
      reason: 'create incident response fixture',
    },
    operator,
    'incident-policy-create',
  );
  const requested = await incidents.requestPolicyVersion(
    policy.policy.id,
    {
      effectiveFrom: '2026-01-01T00:00:00.000000Z',
      effectiveUntil: '2030-01-01T00:00:00.000000Z',
      tier: 2,
      procedure: 'Synthetic operator investigation; no notification or control',
      acknowledgementTargetMicroseconds: '60000000',
      resolutionTargetMicroseconds: '300000000',
      reason: 'request synthetic response targets',
    },
    operator,
    'incident-policy-request',
  );
  await incidents.approvePolicyVersion(
    policy.policy.id,
    requested.policyVersion.version,
    'independent policy approval',
    director,
    'incident-policy-approve',
  );

  const concurrent = await Promise.allSettled([
    incidents.createIncident(alarmId, 'open synthetic operator case', operator, 'incident-open-a'),
    new PostgresIncidentService(databaseUrl).createIncident(
      alarmId,
      'competing case must lose',
      operator,
      'incident-open-b',
    ),
  ]);
  assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(concurrent.filter((result) => result.status === 'rejected').length, 1);
  const opened = concurrent.find((result) => result.status === 'fulfilled')!;
  assert.equal(opened.status, 'fulfilled');
  const openedValue = opened.value as Awaited<
    ReturnType<PostgresIncidentService['createIncident']>
  >;
  const incidentId = (openedValue as { incident: { id: string } }).incident.id;
  const snapshot = openedValue as {
    incident: {
      escalationPolicyId: string | null;
      escalationPolicyVersionId: string | null;
      escalationTier: number | null;
      dataClassification: string;
      officialComplianceEligible: boolean;
    };
  };
  assert.equal(snapshot.incident.escalationPolicyId, policy.policy.id);
  assert.equal(snapshot.incident.escalationPolicyVersionId, requested.policyVersion.id);
  assert.equal(snapshot.incident.escalationTier, 2);
  assert.equal(snapshot.incident.dataClassification, 'synthetic');
  assert.equal(snapshot.incident.officialComplianceEligible, false);
  await assert.rejects(
    incidents.getIncident(incidentId, '2025-01-01T00:00:00.000000Z'),
    /cannot precede/i,
  );
  assert.equal(
    Number(
      (
        await pool.query<{ count: string }>(
          'SELECT count(*)::text count FROM incident_alarm_links WHERE alarm_id=$1',
          [alarmId],
        )
      ).rows[0]!.count,
    ),
    1,
  );

  await assert.rejects(
    incidents.action(
      incidentId,
      'resolved',
      'cannot resolve active alarm',
      operator,
      'incident-bad-resolve',
    ),
    (error: unknown) => error instanceof IncidentError && error.kind === 'VALIDATION_ERROR',
  );
  await incidents.action(
    incidentId,
    'acknowledged',
    'operator acknowledged',
    operator,
    'incident-ack',
  );
  await incidents.action(
    incidentId,
    'investigating',
    'begin investigation',
    operator,
    'incident-investigate',
  );
  await assert.rejects(
    incidents.assign(
      incidentId,
      auditor,
      'auditor cannot own case',
      operator,
      'incident-bad-assignee',
    ),
    /lacks incident authority/i,
  );
  await incidents.assign(
    incidentId,
    maintainer,
    'assign field investigation',
    operator,
    'incident-assign',
  );
  await incidents.note(
    incidentId,
    'commented',
    'Synthetic field evidence is being reviewed.',
    'record investigation comment',
    operator,
    'incident-comment',
  );
  await incidents.note(
    incidentId,
    'corrective_action',
    'Synthetic inspection recorded; no physical command was issued.',
    'record corrective-action evidence',
    operator,
    'incident-corrective',
  );

  await stage('2030-01-01T00:00:00.000020Z', '11');
  const clearFact = await stage('2030-01-01T00:00:00.000030Z', '11');
  const cleared = await alarms.materialize(
    rule.id,
    '2030-01-01T00:00:00.000030Z',
    clearFact.ingestedAt,
    operator,
    'incident-alarm-clear',
  );
  assert.equal(cleared.alarm?.automaticState, 'cleared');
  const beforeResolution = (await incidents.getIncident(
    incidentId,
    new Date(Date.now() + 1000).toISOString(),
  )) as { incident: { status: string } };
  assert.equal(beforeResolution.incident.status, 'investigating');

  await incidents.action(
    incidentId,
    'resolved',
    'human review concludes response',
    operator,
    'incident-resolve',
  );
  const closed = (await incidents.action(
    incidentId,
    'closed',
    'close completed synthetic case',
    operator,
    'incident-close',
  )) as {
    incident: { status: string; linkedAlarmIds: string[]; timeline: Array<{ kind: string }> };
    metrics: { acknowledgement: { state: string }; resolution: { state: string } };
  };
  assert.equal(closed.incident.status, 'closed');
  assert.deepEqual(closed.incident.linkedAlarmIds, [alarmId]);
  assert.deepEqual(
    closed.incident.timeline.map((entry) => entry.kind),
    [
      'created',
      'acknowledged',
      'investigating',
      'assigned',
      'commented',
      'corrective_action',
      'resolved',
      'closed',
    ],
  );
  assert.equal(closed.metrics.acknowledgement.state, 'acknowledgement_met');
  assert.equal(closed.metrics.resolution.state, 'resolution_met');
  const successor = await incidents.requestPolicyVersion(
    policy.policy.id,
    {
      effectiveFrom: '2030-01-01T00:00:00.000000Z',
      effectiveUntil: '2031-01-01T00:00:00.000000Z',
      tier: 4,
      procedure: 'Later synthetic procedure must not rewrite closed cases',
      acknowledgementTargetMicroseconds: '1000000',
      resolutionTargetMicroseconds: '2000000',
      reason: 'request later non-overlapping policy',
    },
    operator,
    'incident-policy-successor-request',
  );
  await incidents.approvePolicyVersion(
    policy.policy.id,
    successor.policyVersion.version,
    'approve later policy without rewriting history',
    director,
    'incident-policy-successor-approve',
  );
  const afterPolicyChange = (await incidents.getIncident(
    incidentId,
    new Date(Date.now() + 1000).toISOString(),
  )) as {
    incident: { escalationPolicyVersionId: string; escalationTier: number };
  };
  assert.equal(afterPolicyChange.incident.escalationPolicyVersionId, requested.policyVersion.id);
  assert.equal(afterPolicyChange.incident.escalationTier, 2);
  await assert.rejects(
    incidents.note(
      incidentId,
      'commented',
      'forged post-close comment',
      'closed cases are immutable',
      operator,
      'incident-after-close',
    ),
    /invalid|history/i,
  );

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SAVEPOINT forged_incident');
    await assert.rejects(
      client.query(
        `INSERT INTO incidents(organization_id,territory_id,primary_alarm_id,status,
          created_by_user_id,creation_reason,created_request_id)
         SELECT organization_id,territory_id,id,'closed',$2,$3,$4 FROM alarms WHERE id=$1`,
        [alarmId, operator, 'forge closed incident', 'incident-forged-create'],
      ),
      /initial state/i,
    );
    await client.query('ROLLBACK TO SAVEPOINT forged_incident');
    for (const attempt of [
      {
        kind: 'closed',
        requestId: 'incident-forged-duplicate-close',
        sql: `INSERT INTO incident_timeline(incident_id,kind,actor_user_id,reason,request_id)
              VALUES($1,'closed',$2,$3,$4)`,
      },
      {
        kind: 'alarm_linked',
        requestId: 'incident-forged-link-history',
        sql: `INSERT INTO incident_timeline(incident_id,kind,actor_user_id,alarm_id,reason,request_id)
              VALUES($1,'alarm_linked',$2,$3,$4,$5)`,
      },
      {
        kind: 'commented',
        requestId: 'incident-forged-post-close-comment',
        sql: `INSERT INTO incident_timeline(incident_id,kind,actor_user_id,reason,body,request_id)
              VALUES($1,'commented',$2,$3,'forged body',$4)`,
      },
    ] as const) {
      const reason = `reject forged ${attempt.kind} history`;
      await client.query(
        `SELECT set_config('isuv.incident_actor_id',$1,true),
          set_config('isuv.incident_reason',$2,true),
          set_config('isuv.incident_request_id',$3,true)`,
        [operator, reason, attempt.requestId],
      );
      await client.query('SAVEPOINT forged_timeline');
      await assert.rejects(
        client.query(
          attempt.sql,
          attempt.kind === 'alarm_linked'
            ? [incidentId, operator, alarmId, reason, attempt.requestId]
            : [incidentId, operator, reason, attempt.requestId],
        ),
        /duplicate|timeline state|history/i,
      );
      await client.query('ROLLBACK TO SAVEPOINT forged_timeline');
    }
    await assert.rejects(
      client.query('DELETE FROM incident_timeline WHERE incident_id=$1', [incidentId]),
      /immutable/i,
    );
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }

  const audit = (
    await pool.query<{ action: string }>(
      `SELECT action::text action FROM audit_events
       WHERE resource IN('incident','escalation_policy')
         AND (resource_id=$1 OR resource_id=$2 OR resource_id=$3)
       ORDER BY occurred_at,id`,
      [incidentId, policy.policy.id, requested.policyVersion.id],
    )
  ).rows.map((row) => row.action);
  assert.deepEqual(audit, [
    'escalation_policy.created',
    'escalation_policy_version.requested',
    'escalation_policy_version.approved',
    'incident.created',
    'incident.acknowledged',
    'incident.investigating',
    'incident.assigned',
    'incident.commented',
    'incident.corrective_action',
    'incident.resolved',
    'incident.closed',
  ]);
  const alarmAfter = (
    await pool.query<{ automatic_state: string; severity: string; event_type: string }>(
      'SELECT automatic_state,severity,event_type FROM alarms WHERE id=$1',
      [alarmId],
    )
  ).rows[0]!;
  assert.deepEqual(alarmAfter, {
    automatic_state: 'cleared',
    severity: 'warning',
    event_type: 'dry_canal',
  });
});
