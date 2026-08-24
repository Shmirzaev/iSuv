import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mapNetworkQuerySchema,
  mapNetworkResponseSchema,
  playbackResponseSchema,
  traceQuerySchema,
} from './map-network.js';

const id = '12000000-0000-4000-8000-000000000001';
const at = '2026-08-24T07:34:56.123456Z';
const source = {
  kind: 'synthetic_scenario',
  label: 'synthetic map scenario',
  provenance: 'synthetic',
  official: false,
} as const;
const unconfigured = { state: 'unconfigured', source: 'unconfigured', reason: 'none' } as const;

test('map contract keeps stage, discharge, and accumulated volume separate', () => {
  const value = {
    referenceAt: at,
    knownAt: at,
    scenario: source,
    detail: 'overview',
    scope: { stationCount: 83, deviceCount: 83 },
    overview: [],
    layers: { waterways: [], junctions: [], sections: [], stations: [] },
    panel: {
      stationId: id,
      responsibleTerritory: { id, code: 'SYNTH', name: 'Synthetic territory' },
      stage: { value: '1', unit: 'm', state: 'reported', observedAt: at, ingestedAt: at, source },
      discharge: {
        value: '2',
        unit: 'm3/s',
        state: 'reported',
        observedAt: at,
        ingestedAt: at,
        source,
      },
      counter: {
        value: '3',
        unit: 'm3',
        state: 'reported',
        observedAt: at,
        ingestedAt: at,
        source,
      },
      health: {
        connection: 'unknown',
        fault: 'unknown',
        dataCondition: 'unknown',
        lastSeenReceivedAt: null,
        lastObservedAt: null,
        power: { value: null, unit: 'V' },
        signal: { value: null, unit: 'dBm' },
        source,
      },
      targetDischarge: unconfigured,
      deliveredVolume: unconfigured,
      plannedVolume: unconfigured,
      variance: unconfigured,
      duration: unconfigured,
      confidence: unconfigured,
      balance: unconfigured,
    },
  };
  assert.equal(mapNetworkResponseSchema.parse(value).panel?.counter.unit, 'm3');
  assert.throws(() =>
    mapNetworkResponseSchema.parse({
      ...value,
      panel: { ...value.panel, stage: { ...value.panel.stage, unit: 'm3' } },
    }),
  );
  assert.throws(() =>
    mapNetworkResponseSchema.parse({
      ...value,
      panel: { ...value.panel, stage: { ...value.panel.stage, state: 'no_data' } },
    }),
  );
});

test('strict queries reject client-provided graph state', () => {
  assert.equal(mapNetworkQuerySchema.parse({ detail: 'overview' }).detail, 'overview');
  assert.throws(() => mapNetworkQuerySchema.parse({ stations: [id] }));
  assert.throws(() => traceQuerySchema.parse({ stationId: id, graph: 'forged' }));
});

test('playback is exactly 24 synthetic paused stage frames and preserves a gap', () => {
  const frames = Array.from({ length: 24 }, (_, index) => ({
    at: `2026-08-23T${String(index).padStart(2, '0')}:00:00.000000Z`,
    raw: index === 4 ? null : '1',
    validated: index === 4 ? null : '1',
    gap: index === 4,
    source,
  }));
  assert.equal(
    playbackResponseSchema.parse({
      stationId: id,
      unit: 'm',
      referenceAt: at,
      knownAt: at,
      paused: true,
      frames,
      disclaimer: 'Synthetic, paused, and not interpolated.',
    }).frames[4]?.gap,
    true,
  );
});
