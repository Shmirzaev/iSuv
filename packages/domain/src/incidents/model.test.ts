import assert from 'node:assert/strict';
import test from 'node:test';
import { canTransitionIncident, incidentMetric, incidentTimestampMicroseconds } from './model.js';

test('incident lifecycle is human-controlled and requires automatic clears to resolve or close', () => {
  assert.equal(canTransitionIncident('open', 'acknowledge', false), true);
  assert.equal(canTransitionIncident('acknowledged', 'investigate', false), true);
  assert.equal(canTransitionIncident('investigating', 'resolve', false), false);
  assert.equal(canTransitionIncident('investigating', 'resolve', true), true);
  assert.equal(canTransitionIncident('resolved', 'close', true), true);
  assert.equal(canTransitionIncident('closed', 'acknowledge', true), false);
});

test('incident metrics preserve exact microsecond boundaries and unconfigured state', () => {
  assert.deepEqual(incidentMetric('acknowledgement', 10n, null, 15n, 5n), {
    state: 'acknowledgement_pending',
    elapsedMicroseconds: 5n,
  });
  assert.deepEqual(incidentMetric('acknowledgement', 10n, null, 16n, 5n), {
    state: 'acknowledgement_overdue',
    elapsedMicroseconds: 6n,
  });
  assert.deepEqual(incidentMetric('resolution', 10n, 15n, 99n, 5n), {
    state: 'resolution_met',
    elapsedMicroseconds: 5n,
  });
  assert.deepEqual(incidentMetric('resolution', 10n, null, 15n, null), {
    state: 'unconfigured',
    elapsedMicroseconds: 5n,
  });
  assert.throws(() => incidentMetric('resolution', 10n, null, 9n, 5n), /cannot precede/i);
});

test('incident timestamps preserve microseconds and equivalent UTC offsets', () => {
  assert.equal(
    incidentTimestampMicroseconds('2030-01-01T05:00:00.000001+05:00'),
    incidentTimestampMicroseconds('2030-01-01T00:00:00.000001Z'),
  );
  assert.equal(
    incidentTimestampMicroseconds('2030-01-01T00:00:00.000002Z') -
      incidentTimestampMicroseconds('2030-01-01T00:00:00.000001Z'),
    1n,
  );
});
