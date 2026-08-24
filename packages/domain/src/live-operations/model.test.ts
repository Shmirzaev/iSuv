import assert from 'node:assert/strict';
import test from 'node:test';
import { attentionPresentation, liveAttention } from './model.js';

test('live attention never presents missing, unreliable, or fault evidence as reported', () => {
  assert.equal(
    liveAttention({ dataState: 'reported', connection: 'offline', fault: 'none' }),
    'attention',
  );
  assert.equal(
    liveAttention({ dataState: 'reported', connection: 'communicating', fault: 'reported' }),
    'attention',
  );
  assert.equal(
    liveAttention({ dataState: 'no_data', connection: 'communicating', fault: 'none' }),
    'no_data',
  );
  assert.equal(
    liveAttention({ dataState: 'unreliable', connection: 'communicating', fault: 'none' }),
    'unreliable',
  );
  assert.equal(
    liveAttention({ dataState: 'reported', connection: 'unknown', fault: 'none' }),
    'unreliable',
  );
  assert.equal(
    liveAttention({ dataState: 'reported', connection: 'communicating', fault: 'none' }),
    'reported',
  );
});

test('every live attention state exposes label, icon, and value', () => {
  for (const state of ['attention', 'unreliable', 'no_data', 'reported'] as const) {
    const presentation = attentionPresentation(state);
    assert.ok(presentation.label);
    assert.ok(presentation.icon);
    assert.ok(presentation.value);
  }
});
