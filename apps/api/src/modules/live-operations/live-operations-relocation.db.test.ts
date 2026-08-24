import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { Pool } from 'pg';
import { PostgresLiveOperationsService } from './service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const pool = new Pool({ connectionString: databaseUrl });
after(async () => pool.end());

const nationalTerritoryId = 'a2000000-0000-4000-8000-000000000001';
const scenarioId = 'd6000000-0000-4000-8000-000000000001';
const installationId = 'd6200000-0000-4000-8000-000000000001';
const lineageId = 'd6200000-0000-4000-8000-000000000002';
const rawRevisionId = 'd6200000-0000-4000-8000-000000000003';
const validRevisionId = 'd6200000-0000-4000-8000-000000000004';

// This regression advances one seeded device's installation timeline and must
// therefore run against a disposable freshly migrated and seeded database.
test('canonical overlay cannot cross a device relocation boundary', async () => {
  const target = (
    await pool.query<{
      organization_id: string;
      territory_id: string;
      station_id: string;
      device_id: string;
      installation_id: string;
      sensor_id: string;
      fallback_stage: string;
    }>(
      `SELECT station.organization_id,row.territory_id,row.station_id,row.device_id,
         row.installation_id,sensor.id sensor_id,row.stage_m::text fallback_stage
       FROM live_operations_synthetic_rows row
       JOIN monitoring_stations station ON station.id=row.station_id
       JOIN telemetry_sensors sensor ON sensor.device_id=row.device_id
         AND sensor.measurement_kind='stage'
       WHERE row.scenario_id=$1 ORDER BY station.code LIMIT 1`,
      [scenarioId],
    )
  ).rows[0]!;
  const destination = (
    await pool.query<{ territory_id: string; station_id: string }>(
      `SELECT territory_id,station_id FROM live_operations_synthetic_rows
       WHERE scenario_id=$1 AND territory_id<>$2 ORDER BY station_id LIMIT 1`,
      [scenarioId, target.territory_id],
    )
  ).rows[0]!;

  await pool.query(
    `UPDATE telemetry_device_installations SET effective_until='2026-08-24T07:34:00.123456Z'
     WHERE id=$1 AND effective_until IS NULL`,
    [target.installation_id],
  );
  await pool.query(
    `INSERT INTO telemetry_device_installations(id,organization_id,territory_id,device_id,
       station_id,effective_from,provenance,data_classification)
     VALUES($1,$2,$3,$4,$5,'2026-08-24T07:34:00.123456Z',
       'synthetic: relocation isolation test','synthetic')`,
    [
      installationId,
      target.organization_id,
      destination.territory_id,
      target.device_id,
      destination.station_id,
    ],
  );
  await pool.query(
    `INSERT INTO observation_lineages(id,organization_id,territory_id,sensor_id,device_id,
       device_installation_id,station_id,measurement_kind,unit,data_classification,source_system,
       source_event_id,observed_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,'stage','m','synthetic','live-operations-relocation-test',
       'relocated-stage-source','2026-08-24T07:34:30.123456Z')`,
    [
      lineageId,
      target.organization_id,
      destination.territory_id,
      target.sensor_id,
      target.device_id,
      installationId,
      destination.station_id,
    ],
  );
  await pool.query(
    `INSERT INTO observation_revisions(id,lineage_id,revision,state,quality_state,quality_reason,
       value,unit,provenance,data_classification,measurement_method,ingested_at)
     VALUES($1,$2,1,'raw','unknown','Relocated raw source is not governed-valid.',99.1,'m',
       'synthetic: relocated raw overlay test','synthetic','direct stage sensor',
       '2026-08-24T07:34:31.123456Z')`,
    [rawRevisionId, lineageId],
  );
  await pool.query(
    `INSERT INTO observation_revisions(id,lineage_id,revision,state,quality_state,value,unit,
       provenance,data_classification,measurement_method,ingested_at)
     VALUES($1,$2,2,'automatically_validated','valid',99.2,'m',
       'synthetic: relocated governed overlay test','synthetic','direct stage sensor',
       '2026-08-24T07:34:32.123456Z')`,
    [validRevisionId, lineageId],
  );

  const selected = await new PostgresLiveOperationsService(databaseUrl).list(nationalTerritoryId, {
    deviceId: target.device_id,
    limit: 1,
  });
  assert.ok(selected);
  assert.equal(selected.rows.length, 1);
  assert.equal(selected.rows[0]!.quantities.stage.value, target.fallback_stage);
  assert.equal(selected.rows[0]!.quantities.stage.source.kind, 'synthetic_scenario');
  assert.notEqual(selected.rows[0]!.quantities.stage.observationId, validRevisionId);
});
