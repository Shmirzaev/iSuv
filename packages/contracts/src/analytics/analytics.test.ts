import assert from 'node:assert/strict';
import test from 'node:test';
import { analyticsQuerySchema, analyticsResponseSchema } from './analytics.js';

test('analytics query requires a complete server-resolved facet pair', () => {
  assert.equal(analyticsQuerySchema.safeParse({ facet: 'section' }).success, false);
  assert.equal(
    analyticsQuerySchema.safeParse({ facetId: '12000000-0000-4000-8000-000000000001' }).success,
    false,
  );
  assert.equal(analyticsQuerySchema.safeParse({ period: 'year' }).success, true);
});

test('analytics response rejects unreconciled matrix and availability totals', () => {
  const value = {
    referenceAt: '2026-08-24T00:00:00.000000Z',
    knownAt: '2026-08-24T00:00:01.000000Z',
    presentationTimeZone: 'Asia/Tashkent',
    windows: {
      selected: { start: '2026-08-23T19:00:00.000000Z', end: '2026-08-24T00:00:00.000000Z' },
      prior: { start: '2026-08-23T14:00:00.000000Z', end: '2026-08-23T19:00:00.000000Z' },
    },
    scenario: {
      id: '12000000-0000-4000-8000-000000000001',
      version: 1,
      method: 'governed_p3_composition_v1',
      provenance: 'synthetic',
      synthetic: true,
      officialComplianceEligible: false,
      forecast: false,
    },
    scope: {
      territoryId: '12000000-0000-4000-8000-000000000001',
      descendantTerritoryIds: ['12000000-0000-4000-8000-000000000001'],
      facet: null,
      facetId: null,
      allowedFacets: [],
      stationDenominator: 1,
      deviceDenominator: 1,
    },
    delivery: {
      state: 'assessed',
      population: { defined: 1, returned: 1, complete: true },
      memberCounts: { total: 1, assessed: 1, over: 1, within: 0, under: 0, unassessable: 0 },
      plannedM3: { numerator: '2', denominator: '1', unit: 'm3' },
      actualM3: { numerator: '3', denominator: '1', unit: 'm3' },
      signedVarianceM3: { numerator: '1', denominator: '1', unit: 'm3' },
      absoluteVarianceM3: { numerator: '1', denominator: '1', unit: 'm3' },
      exclusionNote: 'all governed members are exact',
      groups: [
        {
          sectionId: '12000000-0000-4000-8000-000000000002',
          sectionName: 'Synthetic section',
          territoryId: '12000000-0000-4000-8000-000000000001',
          plannedM3: { numerator: '2', denominator: '1', unit: 'm3' },
          actualM3: { numerator: '3', denominator: '1', unit: 'm3' },
          signedVarianceM3: { numerator: '1', denominator: '1', unit: 'm3' },
          absoluteVarianceM3: { numerator: '1', denominator: '1', unit: 'm3' },
          condition: 'over',
          state: 'assessed',
          reason: null,
          planVersionId: '12000000-0000-4000-8000-000000000003',
          toleranceVersionId: '12000000-0000-4000-8000-000000000004',
          method: 'direct_discharge',
          mapTarget: '#map?sectionId=12000000-0000-4000-8000-000000000002',
          liveTarget: '#operations?deviceId=12000000-0000-4000-8000-000000000005',
          provenance: {
            dataClassification: 'synthetic',
            officialComplianceEligible: false,
            label: 'synthetic',
          },
        },
      ],
    },
    deviationMatrix: {
      over: {
        count: 0,
        plannedM3: { numerator: '0', denominator: '1', unit: 'm3' },
        actualM3: { numerator: '0', denominator: '1', unit: 'm3' },
        absoluteVarianceM3: { numerator: '0', denominator: '1', unit: 'm3' },
      },
      within: {
        count: 0,
        plannedM3: { numerator: '0', denominator: '1', unit: 'm3' },
        actualM3: { numerator: '0', denominator: '1', unit: 'm3' },
        absoluteVarianceM3: { numerator: '0', denominator: '1', unit: 'm3' },
      },
      under: {
        count: 0,
        plannedM3: { numerator: '0', denominator: '1', unit: 'm3' },
        actualM3: { numerator: '0', denominator: '1', unit: 'm3' },
        absoluteVarianceM3: { numerator: '0', denominator: '1', unit: 'm3' },
      },
      unassessable: { count: 0 },
    },
    balance: {
      outcome: 'deferred',
      deferReason: 'no_approved_water_balance_model',
      junctionId: '12000000-0000-4000-8000-000000000001',
      modelId: null,
      versionId: null,
      interval: { start: '2026-08-23T19:00:00.000000Z', end: '2026-08-24T00:00:00.000000Z' },
      knownAt: '2026-08-24T00:00:01.000000Z',
      components: [],
      incomingM3: null,
      outgoingM3: null,
      knownAdditionM3: null,
      knownRemovalM3: null,
      storageChangeM3: null,
      assumptionId: null,
      assumptionProvenance: null,
      residualM3: null,
      provenance: 'synthetic',
      dataClassification: 'synthetic',
      officialComplianceEligible: false,
      alarmEligible: false,
    },
    qualityCoverage: {
      denominator: 1,
      completeValid: 1,
      estimatedExcluded: 0,
      unreliable: 0,
      noData: 0,
      unconfigured: 0,
      state: 'assessed',
      provenance: {
        dataClassification: 'synthetic',
        officialComplianceEligible: false,
        label: 'synthetic',
      },
    },
    availability: {
      denominator: 1,
      communicating: 0,
      offline: 0,
      unknown: 0,
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
  };
  assert.equal(analyticsResponseSchema.safeParse(value).success, false);

  value.deviationMatrix.over = {
    count: 1,
    plannedM3: { numerator: '2', denominator: '1', unit: 'm3' },
    actualM3: { numerator: '3', denominator: '1', unit: 'm3' },
    absoluteVarianceM3: { numerator: '1', denominator: '1', unit: 'm3' },
  };
  value.availability.communicating = 1;
  assert.equal(analyticsResponseSchema.safeParse(value).success, true);

  const honestlyIncomplete = {
    ...value,
    delivery: {
      ...value.delivery,
      state: 'unassessable',
      population: { defined: 101, returned: 1, complete: false },
      memberCounts: {
        total: 101,
        assessed: 1,
        over: 1,
        within: 0,
        under: 0,
        unassessable: 100,
      },
      plannedM3: null,
      actualM3: null,
      signedVarianceM3: null,
      absoluteVarianceM3: null,
    },
    deviationMatrix: { ...value.deviationMatrix, unassessable: { count: 100 } },
  };
  assert.equal(analyticsResponseSchema.safeParse(honestlyIncomplete).success, true);

  const falselyAssessed = {
    ...honestlyIncomplete,
    delivery: {
      ...honestlyIncomplete.delivery,
      state: 'assessed',
      plannedM3: value.delivery.plannedM3,
      actualM3: value.delivery.actualM3,
      signedVarianceM3: value.delivery.signedVarianceM3,
      absoluteVarianceM3: value.delivery.absoluteVarianceM3,
    },
  };
  assert.equal(analyticsResponseSchema.safeParse(falselyAssessed).success, false);
});
