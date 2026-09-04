import { strict as assert } from 'node:assert';
import test from 'node:test';
import type { AnalyticsResponse } from '@isuv/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { AnalyticsReadout, AnalyticsWorkspace } from './analytics.js';

const q = (numerator: string) => ({ numerator, denominator: '1', unit: 'm3' as const });
const id = 'a6000000-0000-4000-8000-000000000001';
const response = {
  referenceAt: '2026-08-24T07:34:56.123456Z',
  knownAt: '2026-08-24T07:35:00.123456Z',
  presentationTimeZone: 'Asia/Tashkent',
  windows: {
    selected: { start: '2026-08-23T19:00:00.000000Z', end: '2026-08-24T07:34:56.123456Z' },
    prior: { start: '2026-08-23T06:25:03.876544Z', end: '2026-08-23T19:00:00.000000Z' },
  },
  scenario: {
    id,
    version: 1,
    method: 'governed_p3_composition_v1',
    provenance: 'immutable governed synthetic composition',
    synthetic: true,
    officialComplianceEligible: false,
    forecast: false,
  },
  scope: {
    territoryId: id,
    descendantTerritoryIds: [id],
    facet: null,
    facetId: null,
    allowedFacets: [{ id, kind: 'basin', label: 'Synthetic basin' }],
    stationDenominator: 83,
    deviceDenominator: 83,
  },
  delivery: {
    state: 'unassessable',
    population: { defined: 2, returned: 2, complete: true },
    memberCounts: { total: 2, assessed: 1, over: 1, within: 0, under: 0, unassessable: 1 },
    plannedM3: null,
    actualM3: null,
    signedVarianceM3: null,
    absoluteVarianceM3: null,
    exclusionNote: 'One group is unassessable and excluded.',
    groups: [
      {
        sectionId: id,
        sectionName: 'Synthetic section',
        territoryId: id,
        plannedM3: q('100'),
        actualM3: q('120'),
        signedVarianceM3: q('20'),
        absoluteVarianceM3: q('20'),
        condition: 'over',
        state: 'assessed',
        reason: null,
        planVersionId: id,
        toleranceVersionId: id,
        method: 'direct_discharge',
        mapTarget: '#map?stationId=a6000000-0000-4000-8000-000000000001',
        liveTarget: '#operations?deviceId=a6000000-0000-4000-8000-000000000001',
        provenance: {
          dataClassification: 'synthetic',
          officialComplianceEligible: false,
          label: 'synthetic',
        },
      },
    ],
  },
  deviationMatrix: {
    over: { count: 1, plannedM3: q('100'), actualM3: q('120'), absoluteVarianceM3: q('20') },
    within: { count: 0, plannedM3: q('0'), actualM3: q('0'), absoluteVarianceM3: q('0') },
    under: { count: 0, plannedM3: q('0'), actualM3: q('0'), absoluteVarianceM3: q('0') },
    unassessable: { count: 1 },
  },
  balance: {
    outcome: 'deferred',
    deferReason: 'no_approved_water_balance_model',
    junctionId: id,
    modelId: null,
    versionId: null,
    interval: { start: '2026-08-23T19:00:00.000000Z', end: '2026-08-24T07:34:56.123456Z' },
    knownAt: '2026-08-24T07:35:00.123456Z',
    components: [],
    incomingM3: null,
    outgoingM3: null,
    knownAdditionM3: null,
    knownRemovalM3: null,
    storageChangeM3: null,
    assumptionId: null,
    assumptionProvenance: null,
    residualM3: null,
    provenance: 'governed balance',
    dataClassification: 'synthetic',
    officialComplianceEligible: false,
    alarmEligible: false,
  },
  qualityCoverage: {
    denominator: 83,
    completeValid: 80,
    estimatedExcluded: 1,
    unreliable: 1,
    noData: 1,
    unconfigured: 0,
    state: 'assessed',
    provenance: {
      dataClassification: 'synthetic',
      officialComplianceEligible: false,
      label: 'synthetic',
    },
  },
  availability: {
    denominator: 83,
    communicating: 80,
    offline: 2,
    unknown: 1,
    cadenceState: 'unconfigured',
    reason: 'cadence_unconfigured',
    provenance: {
      dataClassification: 'synthetic',
      officialComplianceEligible: false,
      label: 'synthetic',
    },
  },
  provenance: {
    dataClassification: 'synthetic',
    officialComplianceEligible: false,
    label: 'synthetic',
  },
} as AnalyticsResponse;

test('analytics has accessible semantic equivalents and never presents forecast or control actions', () => {
  const markup = renderToStaticMarkup(
    <AnalyticsReadout
      filters={{ period: 'today' }}
      locale="en"
      onChange={() => undefined}
      response={response}
      state="ready"
    />,
  );
  for (const heading of [
    'Planned versus actual delivery',
    'Deviation matrix',
    'Water balance',
    'Data-quality coverage',
    'Station and device availability',
  ])
    assert.match(markup, new RegExp(heading));
  assert.match(markup, /<table/);
  assert.match(markup, /Unassessable/);
  assert.match(markup, /Water balance deferred/);
  assert.match(markup, /Reporting cadence unconfigured/);
  assert.doesNotMatch(markup, /cadence_unconfigured/);
  assert.match(markup, /href="#map\?stationId=/);
  assert.match(markup, /href="#operations\?deviceId=/);
  assert.doesNotMatch(markup, /control gate|send notification|create work order/i);
  assert.match(markup, /No forecast or AI operational truth is present/);
  assert.equal(
    [...markup.matchAll(/<h[23][^>]*>Planned versus actual delivery<\/h[23]>/g)].length,
    1,
  );
  assert.equal([...markup.matchAll(/<h[23][^>]*>Data-quality coverage<\/h[23]>/g)].length, 1);
});

test('empty delivery retains balance, quality, and availability with localized defer reasons', () => {
  const empty = {
    ...response,
    delivery: { ...response.delivery, groups: [] },
  } as AnalyticsResponse;
  for (const locale of ['en', 'ru', 'uz'] as const) {
    const markup = renderToStaticMarkup(
      <AnalyticsReadout
        filters={{ period: 'today' }}
        locale={locale}
        onChange={() => undefined}
        response={empty}
        state="empty"
      />,
    );
    assert.match(markup, /<table/);
    assert.doesNotMatch(markup, /no_approved_water_balance_model/);
    assert.match(markup, locale === 'en' ? /No approved water-balance model is configured/ : /./);
  }
  const loading = renderToStaticMarkup(<AnalyticsWorkspace access="unavailable" locale="en" />);
  assert.match(loading, /Loading analytics/);
  assert.doesNotMatch(loading, /120 m³/);
});
