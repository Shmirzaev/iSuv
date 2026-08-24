import assert from 'node:assert/strict';
import test from 'node:test';
import {
  liveOperationsInspectorSchema,
  liveOperationsQuerySchema,
  liveOperationsResponseSchema,
} from './live-operations.js';

const ids = {
  scenario: 'd6000000-0000-4000-8000-000000000001',
  territory: 'd6000000-0000-4000-8000-000000000002',
  station: 'd6000000-0000-4000-8000-000000000003',
  device: 'd6000000-0000-4000-8000-000000000004',
  installation: 'd6000000-0000-4000-8000-000000000005',
  stage: 'd6000000-0000-4000-8000-000000000006',
  discharge: 'd6000000-0000-4000-8000-000000000007',
  counter: 'd6000000-0000-4000-8000-000000000008',
};
const source = {
  kind: 'synthetic_scenario' as const,
  label: 'Synthetic fixture; not official telemetry',
  official: false,
  provenance: 'synthetic:test',
};
const quantity = (
  sensorId: string,
  kind: 'stage' | 'discharge' | 'accumulated_volume',
  unit: 'm' | 'm3/s' | 'm3',
) => ({
  sensorId,
  kind,
  value: '1.25',
  unit,
  dataState: 'reported' as const,
  quality: 'valid' as const,
  observedAt: '2026-08-24T07:30:00.123456Z',
  ingestedAt: '2026-08-24T07:30:01.123456Z',
  revision: 1,
  lineageId: null,
  observationId: null,
  workflow: 'synthetic_scenario' as const,
  qualityReason: null,
  uncertainty: null,
  uncertaintyMethod: null,
  measurementMethod: null,
  calibrationRef: null,
  ratingCurveRef: null,
  source,
});
const row = {
  deviceId: ids.device,
  stationId: ids.station,
  territory: { id: ids.territory, name: 'Synthetic district', code: 'SYN-D' },
  waterway: { id: null, name: null, sectionId: null, sectionName: null },
  station: { code: 'SYN-ST', name: 'Synthetic station' },
  device: {
    code: 'SYN-DEV',
    name: 'Synthetic device',
    protocol: 'synthetic-json',
    installationId: ids.installation,
    installationProvenance: 'synthetic:test',
  },
  quantities: {
    stage: quantity(ids.stage, 'stage', 'm'),
    discharge: quantity(ids.discharge, 'discharge', 'm3/s'),
    accumulatedCounter: quantity(ids.counter, 'accumulated_volume', 'm3'),
  },
  health: {
    connection: 'communicating' as const,
    fault: 'none' as const,
    faultCode: null,
    dataCondition: 'current' as const,
    freshness: 'unconfigured' as const,
    lastSeenReceivedAt: '2026-08-24T07:30:02.123456Z',
    lastObservedAt: '2026-08-24T07:30:00.123456Z',
    ageMicroseconds: '1000000',
    power: { state: 'measured' as const, value: '0', unit: 'V' as const },
    signal: { state: 'measured' as const, value: '0', unit: 'dBm' as const },
    source,
  },
  governed: Object.fromEntries(
    ['plan', 'intervalVariance', 'waterStatus', 'calibrationDue', 'alarm', 'incident'].map(
      (key) => [
        key,
        { state: 'unconfigured', source: 'unconfigured', reason: 'No governed source.' },
      ],
    ),
  ),
  attention: { state: 'reported' as const, label: 'Reported', icon: 'check', value: 'Synthetic' },
  synthetic: true as const,
  provenance: 'synthetic:test',
};
const response = {
  referenceAt: '2026-08-24T07:34:56.123456Z',
  knownAt: '2026-08-24T07:34:56.123456Z',
  presentationTimeZone: 'Asia/Tashkent' as const,
  scenario: {
    id: ids.scenario,
    version: 1,
    provenance: 'synthetic:test',
    dataClassification: 'synthetic' as const,
    officialTelemetry: false as const,
  },
  scope: { stationDenominator: 1, deviceDenominator: 1 },
  facets: {
    territories: [
      {
        id: ids.territory,
        code: 'SYN-D',
        name: 'Synthetic district',
        depth: 0,
        path: [ids.territory],
      },
    ],
    waterways: [],
    sections: [],
    stations: [{ id: ids.station, code: 'SYN-ST', name: 'Synthetic station' }],
    devices: [{ id: ids.device, code: 'SYN-DEV', name: 'Synthetic device' }],
    measurementKinds: ['stage', 'discharge', 'accumulated_volume'] as const,
    connections: ['communicating'] as const,
    faults: ['none'] as const,
    dataStates: ['reported'] as const,
    qualities: ['valid'] as const,
    attentions: ['reported'] as const,
  },
  rows: [row],
  nextCursor: null,
};

test('live operations binds hierarchy filters and exact quantity units', () => {
  assert.equal(liveOperationsQuerySchema.parse({ deviceId: ids.device }).limit, 25);
  assert.equal(liveOperationsResponseSchema.parse(response).rows[0]?.quantities.stage.unit, 'm');
  const wrongUnit = structuredClone(response);
  wrongUnit.rows[0]!.quantities.stage.unit = 'm3/s' as 'm';
  assert.equal(liveOperationsResponseSchema.safeParse(wrongUnit).success, false);
  const forged = liveOperationsQuerySchema.safeParse({ sensorIds: [ids.stage] });
  assert.equal(forged.success, false);
});

test('no-data and canonical sources cannot discard or invent revision evidence', () => {
  const badNoData = structuredClone(response);
  Object.assign(badNoData.rows[0]!.quantities.stage, {
    dataState: 'no_data',
    quality: 'unknown',
    value: null,
  });
  assert.equal(liveOperationsResponseSchema.safeParse(badNoData).success, false);
  const badCanonical = structuredClone(response);
  Object.assign(badCanonical.rows[0]!.quantities.stage.source, {
    kind: 'canonical_observation',
  });
  assert.equal(liveOperationsResponseSchema.safeParse(badCanonical).success, false);
  const officialSynthetic = structuredClone(response);
  officialSynthetic.rows[0]!.quantities.stage.source.official = true;
  assert.equal(liveOperationsResponseSchema.safeParse(officialSynthetic).success, false);
});

test('inspector trend makes gaps and raw-to-validated differences explicit', () => {
  const inspector = {
    referenceAt: response.referenceAt,
    knownAt: response.knownAt,
    current: row,
    trend: [
      {
        at: response.referenceAt,
        kind: 'stage',
        raw: null,
        validated: null,
        unit: 'm',
        gap: true,
        source,
      },
      {
        at: response.referenceAt,
        kind: 'stage',
        raw: '1',
        validated: '1.1',
        unit: 'm',
        gap: false,
        source,
      },
    ],
    revisions: [
      {
        observationId: null,
        lineageId: null,
        revision: 1,
        workflow: 'synthetic_scenario',
        quality: 'valid',
        value: '1',
        unit: 'm',
        observedAt: response.referenceAt,
        ingestedAt: response.knownAt,
        reason: null,
        source,
      },
    ],
    healthHistory: { state: 'unconfigured', source: 'unconfigured', reason: 'Not synthesized.' },
    maintenance: {
      state: 'unconfigured',
      records: [],
      source: 'unconfigured',
      reason: 'No maintenance source is configured.',
    },
    placeholders: {
      plan: 'unconfigured',
      intervalVariance: 'unconfigured',
      alarms: 'unconfigured',
      incidents: 'unconfigured',
      firmware: 'unconfigured',
      documents: 'unconfigured',
    },
  };
  assert.equal(liveOperationsInspectorSchema.safeParse(inspector).success, true);
  inspector.trend[0]!.raw = '0';
  assert.equal(liveOperationsInspectorSchema.safeParse(inspector).success, false);
});
