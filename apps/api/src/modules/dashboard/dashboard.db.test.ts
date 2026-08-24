import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { Pool } from 'pg';
import { PostgresDashboardService } from './service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const pool = new Pool({ connectionString: databaseUrl });
after(async () => pool.end());

test('dashboard scenario has all 83 synthetic hotspot station/device denominators per period', async () => {
  const total = await pool.query<{ total: string; composite: string }>(
    `SELECT count(*)::text total,count(DISTINCT (scenario_id,period,station_id))::text composite
     FROM dashboard_synthetic_reporting_rows
     WHERE scenario_id='d5000000-0000-4000-8000-000000000001'`,
  );
  assert.deepEqual(total.rows[0], { total: '415', composite: '415' });
  const rows = await pool.query<{
    period: string;
    stations: string;
    devices: string;
    classifications: string;
  }>(
    `SELECT period,count(*)::text stations,count(DISTINCT device_id)::text devices,
      string_agg(DISTINCT data_state,',' ORDER BY data_state) classifications
     FROM dashboard_synthetic_reporting_rows
     WHERE scenario_id='d5000000-0000-4000-8000-000000000001'
     GROUP BY period ORDER BY period`,
  );
  assert.deepEqual(
    rows.rows.map(({ period, stations, devices, classifications }) => ({
      period,
      stations,
      devices,
      classifications,
    })),
    [
      {
        period: 'month',
        stations: '83',
        devices: '83',
        classifications: 'no_data,reported,unreliable',
      },
      {
        period: 'season',
        stations: '83',
        devices: '83',
        classifications: 'no_data,reported,unreliable',
      },
      {
        period: 'today',
        stations: '83',
        devices: '83',
        classifications: 'no_data,reported,unreliable',
      },
      {
        period: 'week',
        stations: '83',
        devices: '83',
        classifications: 'no_data,reported,unreliable',
      },
      {
        period: 'year',
        stations: '83',
        devices: '83',
        classifications: 'no_data,reported,unreliable',
      },
    ],
  );
  const service = new PostgresDashboardService(databaseUrl);
  const national = await service.dashboard('a2000000-0000-4000-8000-000000000001', 'today');
  assert.ok(national);
  assert.equal(national.scope.stationDenominator, 83);
  assert.equal(national.scope.deviceDenominator, 83);
  assert.equal(national.scenario.dataClassification, 'synthetic');
  assert.equal(national.scenario.officialComplianceEligible, false);
  assert.equal(national.kpis.unexplainedBalance.state, 'unconfigured');
  assert.equal(national.kpis.systemConfidence.state, 'unconfigured');
  assert.equal(national.scenario.definitions.regionalInflowCutSet.memberStationCount, 2);
  assert.equal(national.scenario.definitions.deliveryComparisonSet.memberStationCount, 4);
  assert.ok(national.deviations.length > 0);
  assert.ok(national.deviations.every((deviation) => deviation.territoryName.length > 0));
  assert.equal(national.scenario.period, 'today');
  const week = await service.dashboard('a2000000-0000-4000-8000-000000000001', 'week');
  assert.ok(week);
  assert.equal(week.scenario.period, 'week');
  assert.deepEqual(week.windows.selected, national.windows.selected);
  assert.deepEqual(week.kpis.deliveredVolume.value, national.kpis.deliveredVolume.value);
  const month = await service.dashboard('a2000000-0000-4000-8000-000000000001', 'month');
  assert.ok(month);
  assert.notDeepEqual(month.windows.selected, national.windows.selected);
  assert.notDeepEqual(month.kpis.deliveredVolume.value, national.kpis.deliveredVolume.value);
});

test('dashboard server resolves descendant territory scope and rejects raw fixture rewrite', async () => {
  const service = new PostgresDashboardService(databaseUrl);
  const district = await service.dashboard('a2000000-0000-4000-8000-000000000004', 'week');
  assert.ok(district);
  assert.ok(district.scope.stationDenominator > 0);
  assert.ok(district.scope.stationDenominator < 83);
  assert.ok(district.scope.descendantTerritoryIds.includes('a2000000-0000-4000-8000-000000000004'));
  await assert.rejects(
    pool.query(`UPDATE dashboard_synthetic_reporting_rows SET data_state='reported'
      WHERE ctid=(SELECT ctid FROM dashboard_synthetic_reporting_rows
        WHERE scenario_id='d5000000-0000-4000-8000-000000000001' LIMIT 1)`),
    /immutable/,
  );
});
