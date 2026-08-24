import assert from 'node:assert/strict';
import test from 'node:test';
import { alarmIncidentAttention } from './model.js';
test('automatic clear does not make an open human case or unassessable evidence normal', () => {
  assert.equal(
    alarmIncidentAttention({
      automaticState: 'cleared',
      incidentStatus: 'investigating',
      evidence: { assessment: 'assessable' },
    } as never),
    'human_open',
  );
  assert.equal(
    alarmIncidentAttention({
      automaticState: 'cleared',
      incidentStatus: null,
      evidence: { assessment: 'missing' },
    } as never),
    'unassessable',
  );
});
