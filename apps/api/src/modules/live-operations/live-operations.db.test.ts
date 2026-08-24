import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { liveOperationsInspectorSchema, liveOperationsResponseSchema } from '@isuv/contracts';
import { Pool } from 'pg';
import { PostgresDeviceHealthService } from '../device-health/service.js';
import { PostgresLiveOperationsService } from './service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const pool = new Pool({ connectionString: databaseUrl });
after(async () => pool.end());

const nationalTerritoryId = 'a2000000-0000-4000-8000-000000000001';
const scenarioId = 'd6000000-0000-4000-8000-000000000001';
const lineageId = 'd6100000-0000-4000-8000-000000000001';
const rawRevisionId = 'd6100000-0000-4000-8000-000000000002';
const validRevisionId = 'd6100000-0000-4000-8000-000000000003';
const healthEventId = 'd6100000-0000-4000-8000-000000000004';
const futureHealthEventId = 'd6100000-0000-4000-8000-000000000005';
const foreignHealthEventId = 'd6100000-0000-4000-8000-000000000006';

test('live operations is stable, bitemporal, scoped, and preserves canonical evidence', async () => {
  const count = await pool.query<{ count: string }>(
    'SELECT count(*)::text count FROM live_operations_synthetic_rows WHERE scenario_id=$1',
    [scenarioId],
  );
  assert.equal(count.rows[0]?.count, '83');
  const target = (
    await pool.query<{
      organization_id: string;
      territory_id: string;
      station_id: string;
      device_id: string;
      installation_id: string;
      sensor_id: string;
    }>(
      `SELECT station.organization_id,row.territory_id,row.station_id,row.device_id,row.installation_id,
        sensor.id sensor_id FROM live_operations_synthetic_rows row
       JOIN monitoring_stations station ON station.id=row.station_id
       JOIN telemetry_sensors sensor ON sensor.device_id=row.device_id AND sensor.measurement_kind='stage'
       WHERE row.scenario_id=$1 ORDER BY station.code LIMIT 1`,
      [scenarioId],
    )
  ).rows[0]!;

  await pool.query(
    `INSERT INTO observation_lineages(id,organization_id,territory_id,sensor_id,device_id,
       device_installation_id,station_id,measurement_kind,unit,data_classification,source_system,
       source_event_id,observed_at)
     SELECT $1,$2,$3,$4,$5,$6,$7,'stage','m','synthetic','live-operations-db-test',
       'canonical-stage-source','2026-08-24T07:33:00.123456Z'
     WHERE NOT EXISTS(SELECT 1 FROM observation_lineages WHERE id=$1)`,
    [
      lineageId,
      target.organization_id,
      target.territory_id,
      target.sensor_id,
      target.device_id,
      target.installation_id,
      target.station_id,
    ],
  );
  await pool.query(
    `INSERT INTO observation_revisions(id,lineage_id,revision,state,quality_state,quality_reason,
       value,unit,provenance,data_classification,measurement_method,ingested_at)
     SELECT $1,$2,1,'raw','unknown','Raw source is not governed-valid.',9.100001,'m',
       'synthetic: raw canonical overlay test','synthetic','direct stage sensor',
       '2026-08-24T07:33:01.123456Z'
     WHERE NOT EXISTS(SELECT 1 FROM observation_revisions WHERE id=$1)`,
    [rawRevisionId, lineageId],
  );
  await pool.query(
    `INSERT INTO observation_revisions(id,lineage_id,revision,state,quality_state,value,unit,
       provenance,data_classification,measurement_method,calibration_ref,rating_curve_ref,ingested_at)
     SELECT $1,$2,2,'automatically_validated','valid',9.100002,'m',
       'synthetic: governed canonical overlay test','synthetic','direct stage sensor',
       'calibration:test:v1','rating:test:v1','2026-08-24T07:33:02.123456Z'
     WHERE NOT EXISTS(SELECT 1 FROM observation_revisions WHERE id=$1)`,
    [validRevisionId, lineageId],
  );
  for (const [id, occurredAt, receivedAt, connection] of [
    [healthEventId, '2026-08-24T07:33:30.123456Z', '2026-08-24T07:33:56.123456Z', 'communicating'],
    [futureHealthEventId, '2026-08-24T08:00:00.123456Z', '2026-08-24T08:00:01.123456Z', 'offline'],
  ] as const) {
    await pool.query(
      `INSERT INTO device_health_events(id,organization_id,territory_id,device_id,
         device_installation_id,source_system,source_event_id,source_payload_hash,occurred_at,
         received_at,connection_status,device_fault,power_voltage,signal_strength_dbm,provenance,
         data_classification,data_condition,state_priority)
       SELECT $1,$2,$3,$4,$5,'live-operations-db-test',$6,
         'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
         $7::timestamptz,$8::timestamptz,$9::device_connection_status,'none',0,0,
         'synthetic: canonical health overlay test','synthetic','current',2
       WHERE NOT EXISTS(SELECT 1 FROM device_health_events WHERE id=$1)`,
      [
        id,
        target.organization_id,
        target.territory_id,
        target.device_id,
        target.installation_id,
        `health-${id}`,
        occurredAt,
        receivedAt,
        connection,
      ],
    );
  }

  const foreign = (
    await pool.query<{
      territory_id: string;
      device_id: string;
      installation_id: string;
    }>(
      `SELECT territory_id,device_id,installation_id
       FROM live_operations_synthetic_rows
       WHERE scenario_id=$1 AND territory_id<>$2 ORDER BY station_id LIMIT 1`,
      [scenarioId, target.territory_id],
    )
  ).rows[0]!;
  await pool.query(
    `INSERT INTO device_health_events(id,organization_id,territory_id,device_id,
       device_installation_id,source_system,source_event_id,source_payload_hash,occurred_at,
       received_at,connection_status,device_fault,provenance,data_classification,
       data_condition,state_priority)
     SELECT $1,$2,$3,$4,$5,'live-operations-db-test','foreign-scope-event',
       'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
       '2026-08-24T07:33:40.123456Z','2026-08-24T07:33:41.123456Z',
       'communicating','none','synthetic: foreign scope isolation test','synthetic','current',2
     WHERE NOT EXISTS(SELECT 1 FROM device_health_events WHERE id=$1)`,
    [
      foreignHealthEventId,
      target.organization_id,
      foreign.territory_id,
      foreign.device_id,
      foreign.installation_id,
    ],
  );

  for (const [territoryId, deviceId, eventId] of [
    [target.territory_id, target.device_id, healthEventId],
    [foreign.territory_id, foreign.device_id, foreignHealthEventId],
  ] as const) {
    await pool.query(
      `INSERT INTO device_live_event_journal(organization_id,territory_id,device_id,health_event_id)
       SELECT $1,$2,$3,$4
       WHERE NOT EXISTS(SELECT 1 FROM device_live_event_journal WHERE health_event_id=$4)`,
      [target.organization_id, territoryId, deviceId, eventId],
    );
  }
  const journalIds = await Promise.all(
    [healthEventId, foreignHealthEventId].map(async (eventId) =>
      BigInt(
        (
          await pool.query<{ id: string }>(
            'SELECT id::text id FROM device_live_event_journal WHERE health_event_id=$1',
            [eventId],
          )
        ).rows[0]!.id,
      ),
    ),
  );
  const scopedJournalId = journalIds[0]!;
  const foreignJournalId = journalIds[1]!;
  await pool.query(
    `SELECT setval(pg_get_serial_sequence('device_live_event_journal','id'),
       (SELECT coalesce(max(id),0)+600 FROM device_live_event_journal),true)`,
  );
  await pool.query(
    `INSERT INTO device_live_event_journal(organization_id,territory_id,device_id,health_event_id)
     SELECT $1,$2,$3,$4
     WHERE NOT EXISTS(SELECT 1 FROM device_live_event_journal WHERE health_event_id=$4)`,
    [target.organization_id, target.territory_id, target.device_id, futureHealthEventId],
  );

  const service = new PostgresLiveOperationsService(
    databaseUrl,
    new PostgresDeviceHealthService(databaseUrl),
  );
  const first = await service.list(nationalTerritoryId, { limit: 10 });
  assert.ok(first);
  liveOperationsResponseSchema.parse(first);
  assert.equal(first.scope.stationDenominator, 83);
  assert.equal(first.rows.length, 10);
  assert.ok(first.nextCursor);
  const second = await service.list(nationalTerritoryId, {
    limit: 10,
    cursor: first.nextCursor,
  });
  assert.ok(second);
  liveOperationsResponseSchema.parse(second);
  assert.equal(second.scope.stationDenominator, 83);
  assert.deepEqual(second.facets, first.facets);
  assert.equal(new Set([...first.rows, ...second.rows].map((row) => row.deviceId)).size, 20);
  await assert.rejects(
    service.list(nationalTerritoryId, {
      limit: 10,
      cursor: first.nextCursor,
      connection: 'offline',
    }),
    /CURSOR/,
  );

  const selected = await service.list(nationalTerritoryId, {
    deviceId: target.device_id,
    limit: 1,
  });
  assert.ok(selected);
  liveOperationsResponseSchema.parse(selected);
  assert.equal(selected.rows.length, 1);
  const row = selected.rows[0]!;
  assert.deepEqual(
    [
      row.quantities.stage.unit,
      row.quantities.discharge.unit,
      row.quantities.accumulatedCounter.unit,
    ],
    ['m', 'm3/s', 'm3'],
  );
  assert.equal(row.quantities.stage.value, '9.100002');
  assert.equal(row.quantities.stage.lineageId, lineageId);
  assert.equal(row.quantities.stage.observationId, validRevisionId);
  assert.equal(row.quantities.stage.revision, 2);
  assert.equal(row.quantities.stage.workflow, 'automatically_validated');
  assert.equal(row.quantities.stage.calibrationRef, 'calibration:test:v1');
  assert.equal(row.quantities.stage.ratingCurveRef, 'rating:test:v1');
  assert.equal(row.quantities.stage.source.kind, 'canonical_observation');
  assert.equal(row.health.connection, 'communicating');
  assert.equal(row.health.ageMicroseconds, '60000000');
  assert.deepEqual(row.health.power, { state: 'measured', value: '0', unit: 'V' });
  assert.deepEqual(row.health.signal, { state: 'measured', value: '0', unit: 'dBm' });
  assert.equal(row.health.source.kind, 'canonical_device_health');
  assert.equal(row.governed.plan.state, 'unconfigured');

  const territoryFacet = first.facets.territories.find(
    (territory) => territory.id === row.territory.id,
  )!;
  assert.equal(territoryFacet.path[0], nationalTerritoryId);
  assert.equal(territoryFacet.path.at(-1), territoryFacet.id);
  assert.equal(territoryFacet.depth, territoryFacet.path.length - 1);
  const inspector = await service.inspector(target.device_id, nationalTerritoryId);
  assert.ok(inspector);
  liveOperationsInspectorSchema.parse(inspector);
  assert.deepEqual(
    inspector.revisions.map((revision) => [
      revision.observationId,
      revision.lineageId,
      revision.revision,
      revision.workflow,
      revision.value,
      revision.unit,
    ]),
    [
      [rawRevisionId, lineageId, 1, 'raw', '9.100001', 'm'],
      [validRevisionId, lineageId, 2, 'automatically_validated', '9.100002', 'm'],
    ],
  );
  assert.equal(inspector.trend.length, 24);
  assert.ok(inspector.trend.some((point) => point.gap && point.raw === null));
  assert.ok(
    inspector.trend.some(
      (point) => !point.gap && point.raw !== null && point.raw !== point.validated,
    ),
  );
  assert.ok(
    inspector.trend.every((point) => Date.parse(point.at) <= Date.parse(inspector.referenceAt)),
  );
  assert.equal(inspector.healthHistory.state, 'unconfigured');
  assert.equal(inspector.maintenance.state, 'synthetic_history');
  if (inspector.maintenance.state === 'synthetic_history') {
    assert.equal(inspector.maintenance.records.length, 1);
    const maintenance = inspector.maintenance.records[0]!;
    assert.equal(maintenance.id, 'da100000-0000-4000-8000-000000000001');
    assert.equal(maintenance.deviceId, target.device_id);
    assert.equal(maintenance.type, 'calibration');
    assert.equal(maintenance.status, 'completed');
    assert.equal(maintenance.dataClassification, 'synthetic');
    assert.equal(maintenance.officialRecord, false);
    const audit = await pool.query<{ count: string }>(
      `SELECT count(*)::text count FROM audit_events
       WHERE id=$1 AND resource::text='maintenance_record'
         AND action::text='maintenance_record.created' AND resource_id=$2`,
      [maintenance.auditEventId, maintenance.id],
    );
    assert.equal(audit.rows[0]?.count, '1');
  }

  const scopedLive = await service.live(target.organization_id, null, [target.territory_id]);
  assert.equal(scopedLive.reset, false);
  assert.ok(
    scopedLive.events.some(
      (event) =>
        event.id === scopedJournalId.toString() && event.event.deviceId === target.device_id,
    ),
  );
  assert.equal(
    scopedLive.events.some(
      (event) =>
        event.id === foreignJournalId.toString() || event.event.deviceId === foreign.device_id,
    ),
    false,
  );
  const resetLive = await service.live(target.organization_id, scopedJournalId - 1n, [
    target.territory_id,
  ]);
  assert.equal(resetLive.reset, true);
  assert.deepEqual(resetLive.events, []);

  await assert.rejects(
    pool.query(
      "UPDATE live_operations_synthetic_rows SET data_state='reported' WHERE ctid=(SELECT ctid FROM live_operations_synthetic_rows LIMIT 1)",
    ),
    /immutable/,
  );
  await assert.rejects(
    pool.query(`UPDATE maintenance_records SET status='cancelled'
      WHERE id='da100000-0000-4000-8000-000000000001'`),
    /immutable/,
  );
  const tamperedRecordId = 'da100000-0000-4000-8000-000000000003';
  const tamperedAuditId = 'da100000-0000-4000-8000-000000000004';
  await pool.query(
    `INSERT INTO audit_events(
       id,organization_id,territory_id,actor_user_id,actor_organization_id,action,resource,resource_id,
       old_state,new_state,reason,request_id,occurred_at,data_classification,provenance
     ) VALUES (
       $1,$2,$3,'a3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',
       'maintenance_record.created','maintenance_record',$4,NULL,jsonb_build_object('synthetic',true),
       'tampered linkage test','tampered-linkage','2026-08-22T09:00:00.000000Z','synthetic',
       'synthetic: tampered maintenance audit linkage test'
     ) ON CONFLICT (id) DO NOTHING`,
    [tamperedAuditId, target.organization_id, target.territory_id, tamperedRecordId],
  );
  await assert.rejects(
    pool.query(
      `INSERT INTO maintenance_records(
         id,organization_id,territory_id,device_id,maintenance_type,status,
         scheduled_start_at,scheduled_end_at,recorded_at,created_at,created_by_user_id,
         creation_reason,created_request_id,audit_event_id,provenance
       ) VALUES (
         $1,$2,$3,$4,'inspection','planned',
         '2026-08-23T06:00:00.000000Z','2026-08-23T07:00:00.000000Z',
         '2026-08-22T09:00:00.000000Z','2026-08-22T08:30:00.000000Z',
         'a3000000-0000-4000-8000-000000000002','tampered linkage test','tampered-linkage',$5,
         'synthetic: tampered maintenance audit linkage test'
       )`,
      [
        tamperedRecordId,
        target.organization_id,
        target.territory_id,
        target.device_id,
        tamperedAuditId,
      ],
    ),
    /matching immutable audit event/,
  );
});
