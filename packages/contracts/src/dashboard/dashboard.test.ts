import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboardQuerySchema, dashboardResponseSchema } from './dashboard.js';

const ids = {
  scenario: '12000000-0000-4000-8000-000000000001',
  territory: '12000000-0000-4000-8000-000000000002',
  station: '12000000-0000-4000-8000-000000000003',
  device: '12000000-0000-4000-8000-000000000004',
};
const selected = { start: '2026-08-23T19:00:00.000000Z', end: '2026-08-24T07:34:56.123456Z' };
const m3 = (numerator: string) => ({ numerator, denominator: '1', unit: 'm3' as const });
function validDashboard() {
  return {
    referenceAt: selected.end,
    knownAt: selected.end,
    presentationTimeZone: 'Asia/Tashkent' as const,
    windows: {
      selected: { ...selected },
      prior: { start: '2026-08-23T06:25:03.876544Z', end: selected.start },
    },
    scenario: {
      id: ids.scenario,
      version: 1,
      period: 'today' as const,
      provenance: 'synthetic dashboard test',
      dataClassification: 'synthetic' as const,
      officialComplianceEligible: false as const,
      synthetic: true as const,
      definitions: {
        regionalInflowCutSet: {
          state: 'scenario_classified' as const,
          memberStationCount: 1,
          unit: 'm3/s' as const,
          provenance: 'synthetic ingress',
        },
        deliveryComparisonSet: {
          state: 'scenario_classified' as const,
          memberStationCount: 1,
          unit: 'm3' as const,
          provenance: 'synthetic delivery',
        },
      },
    },
    scope: {
      territoryId: ids.territory,
      descendantTerritoryIds: [ids.territory],
      stationDenominator: 1,
      deviceDenominator: 1,
      reportedStationCount: 1,
      dataStates: { reported: 1, noData: 0, unreliable: 0, unconfigured: 0 },
    },
    kpis: {
      regionalInflow: {
        state: 'scenario_classified' as const,
        value: '1',
        unit: 'm3/s' as const,
        source: 'synthetic_scenario' as const,
        reason: null,
      },
      deliveredVolume: {
        state: 'scenario_classified' as const,
        value: m3('9'),
        unit: 'm3' as const,
        source: 'synthetic_scenario' as const,
        reason: null,
      },
      plannedVolume: {
        state: 'scenario_classified' as const,
        value: m3('10'),
        unit: 'm3' as const,
        source: 'synthetic_scenario' as const,
        reason: null,
      },
      unexplainedBalance: {
        state: 'unconfigured' as const,
        value: null,
        unit: 'm3' as const,
        source: 'unconfigured' as const,
        reason: 'balance policy missing',
      },
      compliance: {
        state: 'scenario_classified' as const,
        assessedDenominator: 1,
        withinCount: 1,
        overCount: 0,
        underCount: 0,
        percentage: { numerator: '100', denominator: '1', unit: 'percent' as const },
        source: 'synthetic_scenario' as const,
        reason: null,
      },
      activeCriticalAlarms: {
        state: 'scenario_classified' as const,
        count: 0,
        source: 'synthetic_scenario' as const,
        reason: null,
      },
      systemConfidence: {
        state: 'unconfigured' as const,
        value: null,
        source: 'unconfigured' as const,
        reason: 'confidence policy missing',
      },
    },
    comparison: {
      state: 'scenario_classified' as const,
      plannedM3: m3('10'),
      actualM3: m3('9'),
      priorActualM3: m3('8'),
      source: 'synthetic_scenario' as const,
      reason: null,
    },
    deviations: [
      {
        stationId: ids.station,
        deviceId: ids.device,
        hotspotCode: 'SYN-HOTSPOT-001',
        territoryId: ids.territory,
        territoryName: 'Synthetic district',
        dataState: 'reported' as const,
        quality: 'valid' as const,
        assessedInterval: { ...selected },
        signedM3: m3('-1'),
        absoluteM3: m3('1'),
        mapTarget: `#map?stationId=${ids.station}`,
        liveTarget: `#operations?deviceId=${ids.device}`,
        source: 'synthetic_scenario' as const,
      },
    ],
  };
}

test('dashboard query refuses client-selected sensor lists and caller-composed state', () => {
  assert.equal(
    dashboardQuerySchema.safeParse({
      period: 'week',
      sensorIds: ['12000000-0000-4000-8000-000000000001'],
    }).success,
    false,
  );
  assert.equal(dashboardQuerySchema.safeParse({ period: 'year', state: 'normal' }).success, false);
  assert.equal(dashboardQuerySchema.safeParse({ period: 'quarter' }).success, false);
});

test('dashboard response refuses official claims and unit conflation', () => {
  const parsed = dashboardResponseSchema.safeParse({
    referenceAt: '2026-08-24T07:34:56.123456Z',
    knownAt: '2026-08-24T07:34:56.123456Z',
    presentationTimeZone: 'Asia/Tashkent',
    windows: {
      selected: { start: '2026-08-23T19:00:00.000000Z', end: '2026-08-24T07:34:56.123456Z' },
      prior: { start: '2026-08-23T06:25:03.876544Z', end: '2026-08-23T19:00:00.000000Z' },
    },
    scenario: {
      id: '12000000-0000-4000-8000-000000000001',
      version: 1,
      provenance: 'synthetic',
      dataClassification: 'official',
      officialComplianceEligible: true,
      synthetic: true,
    },
    scope: {
      territoryId: '12000000-0000-4000-8000-000000000002',
      descendantTerritoryIds: ['12000000-0000-4000-8000-000000000002'],
      stationDenominator: 1,
      deviceDenominator: 1,
      reportedStationCount: 1,
      dataStates: { reported: 1, noData: 0, unreliable: 0, unconfigured: 0 },
    },
    kpis: {},
    comparison: {},
    deviations: [],
  });
  assert.equal(parsed.success, false);
});

test('dashboard response enforces KPI provenance, comparison state, and exact deviation integrity', () => {
  const valid = validDashboard();
  assert.equal(dashboardResponseSchema.safeParse(valid).success, true);
  const badAlarm = {
    ...valid,
    kpis: {
      ...valid.kpis,
      activeCriticalAlarms: {
        ...valid.kpis.activeCriticalAlarms,
        source: 'unconfigured' as string,
      },
    },
  };
  assert.equal(dashboardResponseSchema.safeParse(badAlarm).success, false);
  const badComparison = {
    ...valid,
    comparison: { ...valid.comparison, state: 'unconfigured' as string },
  };
  assert.equal(dashboardResponseSchema.safeParse(badComparison).success, false);
  const badInterval = structuredClone(valid);
  badInterval.deviations[0]!.assessedInterval.start = '2026-08-23T18:00:00.000000Z';
  assert.equal(dashboardResponseSchema.safeParse(badInterval).success, false);
  const badMagnitude = structuredClone(valid);
  badMagnitude.deviations[0]!.absoluteM3 = m3('2');
  assert.equal(dashboardResponseSchema.safeParse(badMagnitude).success, false);
});
