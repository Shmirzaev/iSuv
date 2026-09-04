import { strict as assert } from 'node:assert';
import test from 'node:test';

import type { DashboardResponse } from '@isuv/contracts';
import { renderToStaticMarkup } from 'react-dom/server';

import { DashboardWorkspace } from './dashboard.js';

const metric = (value: DashboardResponse['kpis']['deliveredVolume']['value']) => ({
  state: value ? ('scenario_classified' as const) : ('unconfigured' as const),
  value,
  unit: 'm3' as const,
  source: value ? ('synthetic_scenario' as const) : ('unconfigured' as const),
  reason: value ? null : 'Official policy is not configured.',
});

const dashboard: DashboardResponse = {
  referenceAt: '2026-08-24T07:34:56.123456Z',
  knownAt: '2026-08-24T07:35:00.123456Z',
  presentationTimeZone: 'Asia/Tashkent',
  windows: {
    selected: { start: '2026-08-23T19:00:00.000000Z', end: '2026-08-24T07:34:56.123456Z' },
    prior: { start: '2026-08-23T06:25:03.876544Z', end: '2026-08-23T19:00:00.000000Z' },
  },
  scenario: {
    id: 'd5000000-0000-4000-8000-000000000001',
    version: 1,
    period: 'today',
    provenance: 'immutable synthetic dashboard scenario',
    dataClassification: 'synthetic',
    officialComplianceEligible: false,
    synthetic: true,
    definitions: {
      regionalInflowCutSet: {
        state: 'scenario_classified',
        memberStationCount: 2,
        unit: 'm3/s',
        provenance: 'synthetic cut set',
      },
      deliveryComparisonSet: {
        state: 'scenario_classified',
        memberStationCount: 2,
        unit: 'm3',
        provenance: 'synthetic comparison set',
      },
    },
  },
  scope: {
    territoryId: 'a2000000-0000-4000-8000-000000000001',
    descendantTerritoryIds: ['a2000000-0000-4000-8000-000000000001'],
    stationDenominator: 83,
    deviceDenominator: 83,
    deviceConnectivity: {
      denominator: 83,
      online: 80,
      offline: 2,
      unknown: 1,
      source: 'synthetic_scenario',
      reason: null,
    },
    reportedStationCount: 80,
    dataStates: { reported: 80, noData: 1, unreliable: 1, unconfigured: 1 },
  },
  kpis: {
    regionalInflow: {
      state: 'scenario_classified',
      value: '12.5',
      unit: 'm3/s',
      source: 'synthetic_scenario',
      reason: null,
    },
    deliveredVolume: metric({ numerator: '1200', denominator: '1', unit: 'm3' }),
    plannedVolume: metric({ numerator: '1000', denominator: '1', unit: 'm3' }),
    unexplainedBalance: metric(null),
    compliance: {
      state: 'scenario_classified',
      assessedDenominator: 2,
      withinCount: 1,
      overCount: 1,
      underCount: 0,
      percentage: { numerator: '100', denominator: '2', unit: 'percent' },
      source: 'synthetic_scenario',
      reason: null,
    },
    activeCriticalAlarms: {
      state: 'scenario_classified',
      count: 2,
      source: 'synthetic_scenario',
      reason: null,
    },
    systemConfidence: {
      state: 'unconfigured',
      value: null,
      source: 'unconfigured',
      reason: 'No approved confidence policy.',
    },
  },
  comparison: {
    state: 'scenario_classified',
    plannedM3: { numerator: '1000', denominator: '1', unit: 'm3' },
    actualM3: { numerator: '1200', denominator: '1', unit: 'm3' },
    priorActualM3: { numerator: '1100', denominator: '1', unit: 'm3' },
    source: 'synthetic_scenario',
    reason: null,
  },
  deviations: [
    {
      stationId: 'b2000000-0000-4000-8000-000000000001',
      deviceId: 'c2000000-0000-4000-8000-000000000001',
      hotspotCode: 'SYN-HOTSPOT-001',
      territoryId: 'a2000000-0000-4000-8000-000000000001',
      territoryName: 'Synthetic Zarafshan District',
      dataState: 'reported',
      quality: 'valid',
      assessedInterval: {
        start: '2026-08-23T19:00:00.000000Z',
        end: '2026-08-24T07:34:56.123456Z',
      },
      durationMicroseconds: '900719925474099312345678',
      signedM3: { numerator: '200', denominator: '1', unit: 'm3' },
      absoluteM3: { numerator: '200', denominator: '1', unit: 'm3' },
      mapTarget: '#map?stationId=b2000000-0000-4000-8000-000000000001',
      liveTarget: '#operations?deviceId=c2000000-0000-4000-8000-000000000001',
      source: 'synthetic_scenario',
    },
  ],
};

test('dashboard exposes synthetic provenance, all periods, units, statuses, and drill links', () => {
  const markup = renderToStaticMarkup(
    <DashboardWorkspace
      initialView="advanced"
      locale="en"
      onPeriodChange={() => undefined}
      onRetry={() => undefined}
      period="today"
      response={dashboard}
      state="ready"
    />,
  );
  assert.match(markup, /SYNTHETIC \/ NON-OFFICIAL scenario/);
  assert.match(markup, /title="2026-08-24T07:34:56.123456Z"/);
  assert.match(markup, /Aug 24, 2026, 12:34:56/);
  assert.match(markup, /immutable synthetic dashboard scenario/);
  assert.match(markup, /d5000000-0000-4000-8000-000000000001/);
  assert.match(markup, /Scenario methods and member sets/);
  assert.match(markup, /Regional inflow cut set definition/);
  assert.match(markup, /Delivery comparison set definition/);
  assert.match(markup, /Member stations[^]*?2/);
  assert.match(markup, /synthetic cut set/);
  assert.match(markup, /synthetic comparison set/);
  for (const label of ['Today', 'Week', 'Month', 'Season', 'Year'])
    assert.match(markup, new RegExp(`>${label}</button>`));
  assert.match(markup, /12\.5<\/?span[^>]*> m³\/s/);
  assert.match(markup, /<data value="1200\/1">1,200<\/data>/);
  assert.match(markup, /<data value="100\/2">50<\/data> %/);
  assert.match(markup, /Scenario classified/);
  assert.match(markup, /Unconfigured/);
  assert.match(markup, /Source: <\/strong>Synthetic scenario fixture/);
  assert.match(markup, /Source: <\/strong>Not configured/);
  assert.match(markup, /Device connectivity/);
  assert.match(markup, /Devices assessed for connectivity: 83/);
  assert.match(markup, /Online devices[^]*?80/);
  assert.match(markup, /Offline devices[^]*?2/);
  assert.match(markup, /Devices with unknown connection[^]*?1/);
  assert.match(markup, /Synthetic Zarafshan District/);
  assert.match(markup, /Territory identifier: a2000000-0000-4000-8000-000000000001/);
  assert.match(markup, /title="2026-08-23T19:00:00\.000000Z — 2026-08-24T07:34:56\.123456Z"/);
  assert.match(
    markup,
    /<data value="900719925474099312345678">900,719,925,474,099,312,345,678<\/data> µs/,
  );
  assert.match(markup, /data-label="Exact duration \(microseconds\)"/);
  assert.match(markup, /href="#map\?stationId=b2000000/);
  assert.match(markup, /href="#operations\?deviceId=c2000000/);
});

test('dashboard defaults to a plain-language guided overview while retaining advanced access', () => {
  const markup = renderToStaticMarkup(
    <DashboardWorkspace
      locale="en"
      onPeriodChange={() => undefined}
      onRetry={() => undefined}
      period="today"
      response={dashboard}
      state="ready"
    />,
  );
  assert.match(markup, /What should I do\?/);
  assert.match(
    markup,
    /<li><div><strong>Check urgent alarms<\/strong><\/div><p>Start with critical alarms that may need acknowledgement or assignment\.<\/p><\/li>/,
  );
  assert.match(markup, /Operational overview/);
  assert.match(markup, /Stations needing attention[^]*?>2</);
  assert.match(markup, /Devices needing attention[^]*?>3</);
  assert.match(markup, /Delivery versus plan/);
  assert.match(markup, /Largest delivery differences/);
  assert.match(markup, /Over plan/);
  assert.match(markup, /href="#alarms"/);
  assert.match(markup, /aria-pressed="true"[^>]*>Simple<\/button>/);
  assert.match(markup, /aria-pressed="false"[^>]*>Detailed<\/button>/);
  assert.match(markup, /<details class="workspace-header__provenance">/);
  assert.match(markup, /Scenario identifier/);
  assert.doesNotMatch(markup, /Exact duration \(microseconds\)/);
});

test('delivery versus plan renders a signed actual-minus-planned under-plan variance', () => {
  const underPlanDashboard: DashboardResponse = {
    ...dashboard,
    comparison: {
      state: 'scenario_classified',
      actualM3: { numerator: '408200', denominator: '1', unit: 'm3' },
      plannedM3: { numerator: '418000', denominator: '1', unit: 'm3' },
      priorActualM3: { numerator: '410000', denominator: '1', unit: 'm3' },
      source: 'synthetic_scenario',
      reason: null,
    },
  };
  const markup = renderToStaticMarkup(
    <DashboardWorkspace
      locale="en"
      onPeriodChange={() => undefined}
      onRetry={() => undefined}
      period="today"
      response={underPlanDashboard}
      state="ready"
    />,
  );

  assert.match(
    markup,
    /<dt>Variance<\/dt><dd><span aria-hidden="true">↓<\/span> <span><data value="-9800\/1">-9,800<\/data> m³<\/span><\/dd>/,
  );
  assert.doesNotMatch(
    markup,
    /<dt>Variance<\/dt><dd><span aria-hidden="true">↑<\/span> <span><data value="0\/1">0<\/data>/,
  );
});

test('unavailable and unauthenticated dashboard views do not render values as normal data', () => {
  const unavailable = renderToStaticMarkup(
    <DashboardWorkspace
      locale="en"
      onPeriodChange={() => undefined}
      onRetry={() => undefined}
      period="week"
      response={null}
      state="unavailable"
    />,
  );
  assert.match(unavailable, /Dashboard unavailable/);
  assert.match(unavailable, /Retry dashboard/);
  assert.doesNotMatch(unavailable, /12\.5/);
  const unauthenticated = renderToStaticMarkup(
    <DashboardWorkspace
      locale="en"
      onPeriodChange={() => undefined}
      onRetry={() => undefined}
      period="week"
      response={null}
      state="unauthenticated"
    />,
  );
  assert.match(unauthenticated, /Sign-in required for dashboard/);
});

test('a response for another period is unavailable rather than presented under the selected control', () => {
  const stale = renderToStaticMarkup(
    <DashboardWorkspace
      locale="en"
      onPeriodChange={() => undefined}
      onRetry={() => undefined}
      period="week"
      response={dashboard}
      state="ready"
    />,
  );
  assert.match(stale, /Dashboard unavailable/);
  assert.doesNotMatch(stale, /12\.5/);
});
