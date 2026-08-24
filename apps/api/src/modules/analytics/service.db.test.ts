import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { analyticsResponseSchema } from '@isuv/contracts';
import { Pool } from 'pg';
import { PostgresAllocationDeviationService } from '../allocation-deviation/service.js';
import { PostgresAnalyticsService } from './service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const pool = new Pool({ connectionString: databaseUrl });
const service = new PostgresAnalyticsService(databaseUrl);
const nationalTerritoryId = 'a2000000-0000-4000-8000-000000000001';

after(async () => pool.end());

function equalExact(
  left: { numerator: string; denominator: string },
  right: { numerator: string; denominator: string },
) {
  return (
    BigInt(left.numerator) * BigInt(right.denominator) ===
    BigInt(right.numerator) * BigInt(left.denominator)
  );
}

test('governed analytics reconciles exact delivery and balance at immutable cutoffs', async () => {
  assert.equal(
    await service.findDefaultTerritory(
      'a3000000-0000-4000-8000-000000000002',
      'a1000000-0000-4000-8000-000000000001',
      new Date(),
    ),
    nationalTerritoryId,
  );
  const result = analyticsResponseSchema.parse(
    await service.analytics(nationalTerritoryId, { period: 'today' }),
  );

  assert.equal(result.scenario.synthetic, true);
  assert.equal(result.scenario.officialComplianceEligible, false);
  assert.equal(result.scenario.forecast, false);
  assert.ok(Date.parse(result.knownAt) >= Date.parse(result.referenceAt));
  assert.deepEqual([result.scope.stationDenominator, result.scope.deviceDenominator], [83, 83]);
  assert.deepEqual(result.delivery.memberCounts, {
    total: 1,
    assessed: 1,
    over: 0,
    within: 1,
    under: 0,
    unassessable: 0,
  });
  assert.equal(result.delivery.state, 'assessed');
  assert.ok(result.delivery.plannedM3 && result.delivery.actualM3);
  assert.ok(equalExact(result.delivery.plannedM3, result.delivery.actualM3));
  assert.equal(result.delivery.signedVarianceM3?.numerator, '0');
  assert.match(result.delivery.groups[0]!.liveTarget ?? '', /^#operations\?deviceId=/);
  assert.match(result.delivery.groups[0]!.mapTarget ?? '', /^#map\?sectionId=/);
  assert.equal(result.delivery.groups[0]!.method, 'direct_discharge');
  assert.equal(result.deviationMatrix.within.count, 1);
  assert.ok(equalExact(result.deviationMatrix.within.actualM3, result.delivery.actualM3));

  // The analytics member population is itself bitemporal: plans approved after
  // the immutable scenario cutoff cannot turn a historical aggregate partial.
  const cutoffPopulation = await pool.query<{ approved_at: string }>(
    `SELECT to_char(version_row.approved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') approved_at
       FROM allocation_plans plan
       JOIN allocation_plan_versions version_row ON version_row.plan_id=plan.id
      WHERE plan.water_section_id=ANY($1::uuid[])
        AND version_row.status IN ('approved','superseded')
        AND version_row.approved_at<=$2`,
    [result.delivery.groups.map((group) => group.sectionId), result.knownAt],
  );
  assert.ok(cutoffPopulation.rows.length >= result.delivery.groups.length);
  assert.ok(
    cutoffPopulation.rows.every((row) => Date.parse(row.approved_at) <= Date.parse(result.knownAt)),
  );

  assert.equal(result.balance.outcome, 'computed');
  if (result.balance.outcome !== 'computed') return;
  assert.equal(result.balance.alarmEligible, false);
  assert.equal(result.balance.dataClassification, 'synthetic');
  assert.ok(
    result.balance.components.every((component) => component.derivation.outcome === 'computed'),
  );
  const { incomingM3, outgoingM3, knownAdditionM3, knownRemovalM3, storageChangeM3, residualM3 } =
    result.balance;
  assert.ok(
    incomingM3 && outgoingM3 && knownAdditionM3 && knownRemovalM3 && storageChangeM3 && residualM3,
  );
  const incoming = BigInt(incomingM3.numerator);
  const outgoing = BigInt(outgoingM3.numerator);
  const additions = BigInt(knownAdditionM3.numerator);
  const removals = BigInt(knownRemovalM3.numerator);
  const storage = BigInt(storageChangeM3.numerator);
  const residual = BigInt(residualM3.numerator);
  assert.deepEqual(
    [
      incomingM3.denominator,
      outgoingM3.denominator,
      knownAdditionM3.denominator,
      knownRemovalM3.denominator,
      storageChangeM3.denominator,
      residualM3.denominator,
    ],
    ['1', '1', '1', '1', '1', '1'],
  );
  assert.equal(incoming + additions - outgoing - removals - storage, residual);
});

test('analytics facets are server-owned, scoped, and keep endpoint stations in denominators', async () => {
  const national = await service.analytics(nationalTerritoryId, { period: 'today' });
  assert.ok(national);
  const group = national.delivery.groups[0]!;
  const topology = await pool.query<{ basin_id: string }>(
    `SELECT waterway.basin_id
       FROM water_sections section
       JOIN waterways waterway ON waterway.id=section.waterway_id
      WHERE section.id=$1`,
    [group.sectionId],
  );
  const basinId = topology.rows[0]!.basin_id;
  const basin = await service.analytics(nationalTerritoryId, {
    period: 'today',
    facet: 'basin',
    facetId: basinId,
  });
  assert.ok(basin);
  assert.ok(basin.scope.stationDenominator > 0 && basin.scope.stationDenominator < 83);
  assert.equal(basin.scope.stationDenominator, basin.scope.deviceDenominator);
  assert.equal(basin.delivery.memberCounts.total, 1);
  assert.equal(basin.balance.outcome, 'computed');

  const unrelatedBasinId = national.scope.allowedFacets.find(
    (facet) => facet.kind === 'basin' && facet.id !== basinId,
  )!.id;
  const unrelatedBasin = await service.analytics(nationalTerritoryId, {
    period: 'today',
    facet: 'basin',
    facetId: unrelatedBasinId,
  });
  assert.ok(unrelatedBasin);
  assert.equal(unrelatedBasin.balance.outcome, 'deferred');
  assert.equal(unrelatedBasin.balance.deferReason, 'no_approved_water_balance_model');

  const section = await service.analytics(nationalTerritoryId, {
    period: 'today',
    facet: 'section',
    facetId: group.sectionId,
  });
  assert.ok(section);
  assert.deepEqual([section.scope.stationDenominator, section.scope.deviceDenominator], [1, 1]);
  assert.equal(section.delivery.memberCounts.total, 1);
  assert.equal(
    await service.analytics(nationalTerritoryId, {
      period: 'today',
      facet: 'section',
      facetId: '12000000-0000-4000-8000-000000000099',
    }),
    null,
  );
});

test('one-microsecond interval drift is unassessable and scenario metadata is immutable', async () => {
  const metadata = await pool.query<{
    plan_id: string;
    interval_start: string;
    interval_end: string;
    known_at: string;
    plan_approved_at: string;
    tolerance_approved_at: string;
    plan_seed_flag: string | null;
    tolerance_seed_flag: string | null;
  }>(
    `SELECT plan.id plan_id,
      to_char((entry.interval_start + interval '1 microsecond') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') interval_start,
      to_char(entry.interval_end AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') interval_end,
      to_char(scenario.known_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') known_at,
      to_char(version_row.approved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') plan_approved_at,
      to_char(tolerance.approved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') tolerance_approved_at,
      current_setting('isuv.seed_allow_synthetic_historical_plan',true) plan_seed_flag,
      current_setting('isuv.seed_allow_synthetic_historical_tolerance',true) tolerance_seed_flag
    FROM analytics_synthetic_scenarios scenario
    JOIN allocation_plans plan ON plan.organization_id=scenario.organization_id
    JOIN allocation_plan_versions version_row ON version_row.plan_id=plan.id AND version_row.status='approved'
    JOIN allocation_plan_entries entry ON entry.plan_version_id=version_row.id
    JOIN section_tolerance_policies policy ON policy.water_section_id=plan.water_section_id
    JOIN section_tolerance_policy_versions tolerance ON tolerance.policy_id=policy.id AND tolerance.status='approved'
    WHERE scenario.id='d7000000-0000-4000-8000-000000000001'`,
  );
  const row = metadata.rows[0]!;
  assert.equal(row.plan_seed_flag, null);
  assert.equal(row.tolerance_seed_flag, null);
  assert.ok(Date.parse(row.known_at) >= Date.parse(row.plan_approved_at));
  assert.ok(Date.parse(row.known_at) >= Date.parse(row.tolerance_approved_at));

  const drifted = await new PostgresAllocationDeviationService(databaseUrl).deviation(row.plan_id, {
    intervalStart: row.interval_start,
    intervalEnd: row.interval_end,
    knownAt: row.known_at,
  });
  assert.equal(drifted.outcome, 'plan_interval_not_exact');
  await assert.rejects(
    pool.query(
      `UPDATE analytics_synthetic_scenarios SET provenance='forged' WHERE id='d7000000-0000-4000-8000-000000000001'`,
    ),
    /immutable/,
  );
});
