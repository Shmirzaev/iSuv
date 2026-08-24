import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { Pool } from 'pg';
import { PostgresObservationService } from '../observations/service.js';
import { PostgresWaterBalanceService } from './service.js';
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const pool = new Pool({ connectionString: databaseUrl });
after(async () => pool.end());
test('canonical water balance snapshots every incident section, enforces immutable components and distinct scoped approval', async () => {
  const c = await pool.connect();
  await c.query('BEGIN');
  try {
    const base = (
      await c.query<{ organization_id: string; territory_id: string }>(
        `SELECT organization_id,territory_id FROM network_junctions WHERE lifecycle='active' LIMIT 1`,
      )
    ).rows[0]!;
    const org = base.organization_id,
      territory = base.territory_id,
      creator = 'a3000000-0000-4000-8000-000000000006',
      approver = 'a3000000-0000-4000-8000-000000000002';
    const junction = randomUUID(),
      up = randomUUID(),
      down = randomUUID(),
      incoming = randomUUID(),
      outgoing = randomUUID();
    for (const [id, code] of [
      [junction, 'WBJ'],
      [up, 'WBU'],
      [down, 'WBD'],
    ] as const)
      await c.query(
        `INSERT INTO network_junctions(id,organization_id,territory_id,code,name,lifecycle,status,data_classification) VALUES($1,$2,$3,$4,$4,'active','operational','synthetic')`,
        [id, org, territory, `${code}-${id.slice(0, 8)}`],
      );
    for (const [id, a, b, code] of [
      [incoming, up, junction, 'WBI'],
      [outgoing, junction, down, 'WBO'],
    ] as const)
      await c.query(
        `INSERT INTO water_sections(id,organization_id,territory_id,upstream_junction_id,downstream_junction_id,code,name,lifecycle,status,data_classification) VALUES($1,$2,$3,$4,$5,$6,$6,'active','operational','synthetic')`,
        [id, org, territory, a, b, `${code}-${id.slice(0, 8)}`],
      );
    const sources = [] as {
      stationId: string;
      sensorId: string;
      installationId: string;
      deviceId: string;
    }[];
    for (const j of [junction, junction]) {
      const st = randomUUID(),
        dev = randomUUID(),
        sensor = randomUUID(),
        inst = randomUUID();
      await c.query(
        `INSERT INTO monitoring_stations(id,organization_id,territory_id,junction_id,code,name,lifecycle,status,data_classification) VALUES($1,$2,$3,$4,$5,$5,'active','operational','synthetic')`,
        [st, org, territory, j, `WBS-${st.slice(0, 8)}`],
      );
      await c.query(
        `INSERT INTO telemetry_devices(id,organization_id,territory_id,code,name,protocol,lifecycle,status,data_classification) VALUES($1,$2,$3,$4,$4,'manual','active','operational','synthetic')`,
        [dev, org, territory, `WBD-${dev.slice(0, 8)}`],
      );
      await c.query(
        `INSERT INTO telemetry_device_installations(id,organization_id,territory_id,device_id,station_id,effective_from,provenance,data_classification) VALUES($1,$2,$3,$4,$5,'2020-01-01Z','synthetic:test','synthetic')`,
        [inst, org, territory, dev, st],
      );
      await c.query(
        `INSERT INTO telemetry_sensors(id,organization_id,territory_id,device_id,code,name,measurement_kind,unit,lifecycle,status,data_classification) VALUES($1,$2,$3,$4,$5,$5,'discharge','m3/s','active','operational','synthetic')`,
        [sensor, org, territory, dev, `WBS-${sensor.slice(0, 8)}`],
      );
      sources.push({ stationId: st, sensorId: sensor, installationId: inst, deviceId: dev });
    }
    const service = new PostgresWaterBalanceService(databaseUrl, c);
    const model = await service.create(
      { junctionId: junction, provenance: 'synthetic:test', reason: 'governed test' },
      creator,
      'wb-create',
    );
    const request = {
      effectiveFrom: '2030-01-01T00:00:00.000000Z',
      effectiveUntil: '2030-01-01T01:00:00.000000Z',
      provenance: 'synthetic:test',
      reason: 'snapshot',
      components: [
        {
          waterSectionId: incoming,
          stationId: sources[0]!.stationId,
          sensorId: sources[0]!.sensorId,
          deviceInstallationId: sources[0]!.installationId,
          method: 'direct_discharge' as const,
          role: 'incoming' as const,
          referencePlane: 'downstream' as const,
          travelTimeMicroseconds: '0',
          provenance: 'synthetic:test',
        },
        {
          waterSectionId: outgoing,
          stationId: sources[1]!.stationId,
          sensorId: sources[1]!.sensorId,
          deviceInstallationId: sources[1]!.installationId,
          method: 'direct_discharge' as const,
          role: 'outgoing' as const,
          referencePlane: 'upstream' as const,
          travelTimeMicroseconds: '0',
          provenance: 'synthetic:test',
        },
      ],
      assumptions: [
        {
          intervalStart: '2030-01-01T00:00:00.000000Z',
          intervalEnd: '2030-01-01T01:00:00.000000Z',
          storageChangeM3: '-2',
          knownAdditionM3: '1',
          knownRemovalM3: '0',
          provenance: 'synthetic:test',
        },
      ],
    };
    const v = await service.request(model.id, request, creator, 'wb-request');
    await c.query(
      `INSERT INTO water_balance_version_assumptions(version_id,interval_start,interval_end,storage_change_m3,known_addition_m3,known_removal_m3,provenance)
       VALUES($1,'2030-01-01T00:00:00.000000Z','2030-01-01T00:30:00.000000Z',0,0,0,'synthetic:raw-dml-audit-test')`,
      [v.id],
    );
    await c.query('SAVEPOINT forged_approval_evidence');
    await assert.rejects(
      c.query(
        `INSERT INTO water_balance_versions(model_id,version,status,effective_from,effective_until,provenance,requested_by_user_id,request_reason,requested_request_id,approval_reason)
         VALUES($1,2,'requested','2030-01-02T00:00:00.000000Z','2030-01-02T01:00:00.000000Z','synthetic:forged-approval-test',$2,'raw requested version','wb-forged-request','forged evidence')`,
        [model.id, creator],
      ),
      /check constraint|violates check/i,
    );
    await c.query('ROLLBACK TO SAVEPOINT forged_approval_evidence');
    await c.query('SAVEPOINT self_approval');
    await assert.rejects(
      service.approve(model.id, v.version, 'self approve', creator, 'wb-self'),
      /invalid|approval/i,
    );
    await c.query('ROLLBACK TO SAVEPOINT self_approval');
    await service.approve(model.id, v.version, 'independent approval', approver, 'wb-approve');
    for (const source of sources) {
      const policy = (
        await c.query<{ id: string }>(
          `INSERT INTO integration_coverage_policies(organization_id,territory_id,station_id,sensor_id,device_installation_id,method,data_classification,provenance,created_by_user_id,creation_reason,created_request_id)
           VALUES($1,$2,$3,$4,$5,'direct_discharge','synthetic','synthetic:water-balance-test',$6,'govern balance source','wb-coverage') RETURNING id`,
          [org, territory, source.stationId, source.sensorId, source.installationId, creator],
        )
      ).rows[0]!;
      await c.query(
        `INSERT INTO integration_coverage_policy_versions(policy_id,version,effective_from,effective_until,max_gap_microseconds,requested_by_user_id,request_reason,requested_request_id,approved_by_user_id,approval_reason,approved_request_id)
         VALUES($1,1,'2029-01-01Z','2031-01-01Z',3600000001,$2,'request balance coverage','wb-coverage-request',$3,'approve balance coverage','wb-coverage-approve')`,
        [policy.id, creator, approver],
      );
    }
    const observations = new PostgresObservationService(databaseUrl, c);
    let knownAt = '';
    for (let index = 0; index < sources.length; index++) {
      const source = sources[index]!;
      const value = index === 0 ? '2' : '1';
      for (const observedAt of ['2030-01-01T00:00:00.000000Z', '2030-01-01T01:00:00.000000Z']) {
        const eventId = randomUUID();
        const raw = await observations.ingest({
          sensorId: source.sensorId,
          deviceId: source.deviceId,
          measurementKind: 'discharge',
          sourceSystem: 'water-balance-db-test',
          sourceEventId: eventId,
          observedAt,
          unit: 'm3/s',
          value,
          uncertainty: null,
          qualityState: 'unknown',
          qualityReason: 'awaiting governed correction',
          totalizerTransition: null,
          provenance: 'synthetic:water-balance-db-test',
          measurementMethod: 'synthetic_direct_discharge_fixture',
        });
        const corrected = await observations.correct(
          raw.observation.lineageId,
          {
            workflowState: 'corrected',
            value,
            uncertainty: null,
            qualityState: 'valid',
            qualityReason: null,
            totalizerTransition: null,
            provenance: 'synthetic:governed-water-balance-db-test',
            correctionReason: 'governed balance fixture',
            measurementMethod: 'synthetic_direct_discharge_fixture',
          },
          creator,
          `wb-observation-${eventId}`,
        );
        knownAt = corrected.ingestedAt;
      }
    }
    const computed = await service.calculate(junction, {
      intervalStart: '2030-01-01T00:00:00.000000Z',
      intervalEnd: '2030-01-01T01:00:00.000000Z',
      knownAt,
    });
    assert.equal(computed.outcome, 'computed');
    assert.deepEqual(computed.incomingM3, { numerator: '7200', denominator: '1', unit: 'm3' });
    assert.deepEqual(computed.outgoingM3, { numerator: '3600', denominator: '1', unit: 'm3' });
    assert.deepEqual(computed.residualM3, { numerator: '3603', denominator: '1', unit: 'm3' });
    await c.query('SAVEPOINT immutable');
    await assert.rejects(
      c.query('UPDATE water_balance_version_components SET provenance=$2 WHERE version_id=$1', [
        v.id,
        'x',
      ]),
      /immutable/i,
    );
    await c.query('ROLLBACK TO SAVEPOINT immutable');
    const events = await c.query<{ action: string; old_state: unknown; new_state: unknown }>(
      `SELECT action,old_state,new_state FROM audit_events WHERE resource_id IN ($1,$2) ORDER BY action`,
      [model.id, v.id],
    );
    assert.deepEqual(
      events.rows.map((x) => x.action),
      [
        'water_balance_model.created',
        'water_balance_version.requested',
        'water_balance_version.approved',
      ],
    );
    assert.notEqual(
      events.rows.find((x) => x.action === 'water_balance_version.approved')?.old_state,
      null,
    );
    assert.notEqual(
      events.rows.find((x) => x.action === 'water_balance_version.approved')?.new_state,
      null,
    );
    const detailAudits = await c.query<{ action: string; count: string }>(
      `SELECT action::text,count(*)::text count FROM audit_events
       WHERE action IN ('water_balance_component.created','water_balance_assumption.created')
         AND request_id='wb-request' GROUP BY action ORDER BY action`,
    );
    assert.deepEqual(detailAudits.rows, [
      { action: 'water_balance_assumption.created', count: '2' },
      { action: 'water_balance_component.created', count: '2' },
    ]);
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
});
