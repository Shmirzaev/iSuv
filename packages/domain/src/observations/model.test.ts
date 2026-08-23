import assert from 'node:assert/strict';
import test from 'node:test';
import { observationUsability } from './model.js';

test('only validated or corrected valid observations are usable; absent and raw states stay visible', () => {
  assert.equal(observationUsability(null, null), 'no_data');
  assert.equal(observationUsability(undefined, undefined), 'no_data');
  assert.equal(observationUsability('raw', 'valid'), 'unreliable');
  assert.equal(observationUsability('automatically_validated', 'valid'), 'usable');
  assert.equal(observationUsability('expert_validated', 'valid'), 'usable');
  assert.equal(observationUsability('corrected', 'valid'), 'usable');
  for (const quality of ['unknown', 'suspect', 'invalid', 'estimated'] as const)
    assert.equal(observationUsability('corrected', quality), 'unreliable');
});
