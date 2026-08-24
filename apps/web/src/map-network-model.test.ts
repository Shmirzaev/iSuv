import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  initialMapDetail,
  mapHash,
  mapNetworkPath,
  mapSelectionFromHash,
  markerState,
  playbackFrame,
  tracePath,
} from './map-network-model.js';
test('map hashes and typed endpoints retain only stable station/device selection', () => {
  const stationId = 'b2000000-0000-4000-8000-000000000001';
  assert.equal(mapSelectionFromHash(`#map?stationId=${stationId}`).stationId, stationId);
  assert.equal(mapSelectionFromHash('#map?stationId=bad').stationId, null);
  assert.equal(mapHash({ stationId, deviceId: null }), `#map?stationId=${stationId}`);
  assert.equal(initialMapDetail({ stationId, deviceId: null }), 'network');
  assert.equal(initialMapDetail({ stationId: null, deviceId: null }), 'overview');
  assert.equal(
    mapNetworkPath('network', { stationId, deviceId: null }),
    '/api/v1/map-network?detail=network&stationId=' + stationId,
  );
  assert.match(tracePath(stationId, 'upstream'), /direction=upstream/);
});
test('markers follow current evidence, not invented plan compliance, and playback stays bounded', () => {
  assert.equal(
    markerState({
      health: { fault: 'reported' },
      stage: { state: 'reported' },
      discharge: { state: 'reported' },
    } as never),
    'unreliable',
  );
  assert.equal(
    markerState({
      health: { fault: 'none' },
      stage: { state: 'no_data' },
      discharge: { state: 'reported' },
    } as never),
    'no_data',
  );
  assert.equal(
    playbackFrame({ frames: Array.from({ length: 24 }, (_, index) => index) } as never, 99),
    23,
  );
});
