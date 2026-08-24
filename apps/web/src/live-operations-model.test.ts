import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  formatLiveAge,
  liveAttentionPresentation,
  liveEventsPath,
  liveOperationsPath,
  operationsHash,
  selectedDeviceFromHash,
  streamFailureState,
  streamPresentation,
} from './live-operations-model.js';

test('live filters are URL encoded, bounded, and selection leaves filters in component context', () => {
  assert.equal(
    liveOperationsPath({
      attention: 'unreliable',
      measurementKind: 'discharge',
      quality: 'suspect',
    }),
    '/api/v1/live-operations?measurementKind=discharge&quality=suspect&attention=unreliable&limit=25',
  );
  assert.equal(
    liveEventsPath({ territoryId: 'a2000000-0000-4000-8000-000000000001' }),
    '/api/v1/live-operations/live?territoryId=a2000000-0000-4000-8000-000000000001',
  );
  assert.equal(
    liveOperationsPath({ dataState: 'no_data' }, 'opaque+/cursor'),
    '/api/v1/live-operations?dataState=no_data&cursor=opaque%2B%2Fcursor&limit=25',
  );
  const deviceId = 'c2000000-0000-4000-8000-000000000001';
  assert.equal(selectedDeviceFromHash(operationsHash(deviceId)), deviceId);
  assert.equal(selectedDeviceFromHash('#operations?stationId=x'), null);
  assert.equal(selectedDeviceFromHash('#map?deviceId=' + deviceId), null);
});

test('live states always retain label, icon, and value rather than color-only meaning', () => {
  for (const state of ['attention', 'unreliable', 'no_data', 'reported'] as const) {
    const presentation = liveAttentionPresentation(state);
    assert.ok(presentation.icon);
    assert.ok(presentation.label);
    assert.ok(presentation.value);
  }
  for (const state of ['connecting', 'connected', 'reconnecting', 'unavailable'] as const) {
    const presentation = streamPresentation(state);
    assert.ok(presentation.icon);
    assert.ok(presentation.label);
    assert.ok(presentation.value);
  }
  assert.equal(formatLiveAge('3600000000'), '1 h');
  assert.equal(formatLiveAge(null), '—');
  assert.equal(streamFailureState(true), 'reconnecting');
  assert.equal(streamFailureState(false), 'unavailable');
});
