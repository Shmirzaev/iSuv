import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  alarmCenterHash,
  alarmCenterPath,
  alarmCenterSelectionFromHash,
  automaticStatePresentation,
  actionErrorKey,
  capabilityDisabledReasonKey,
  evidencePresentation,
  formatAlarmCenterMicros,
  incidentStatePresentation,
  severityPresentation,
} from './alarm-incident-center-model.js';

const alarmId = 'a2000000-0000-4000-8000-000000000001';
const incidentId = 'b2000000-0000-4000-8000-000000000001';

test('alarm center deep links have one authoritative resource selector and filters remain server-owned', () => {
  assert.deepEqual(alarmCenterSelectionFromHash(`#alarms?alarmId=${alarmId}`), {
    alarmId,
    incidentId: null,
  });
  assert.deepEqual(
    alarmCenterSelectionFromHash(`#alarms?alarmId=${alarmId}&incidentId=${incidentId}`),
    {
      alarmId: null,
      incidentId,
    },
  );
  assert.deepEqual(alarmCenterSelectionFromHash('#alarms?alarmId=forged'), {
    alarmId: null,
    incidentId: null,
  });
  assert.equal(alarmCenterHash({ alarmId, incidentId: null }), `#alarms?alarmId=${alarmId}`);
  assert.equal(alarmCenterHash({ alarmId, incidentId }), `#alarms?incidentId=${incidentId}`);
  assert.equal(
    alarmCenterPath(
      { severity: 'critical', automaticState: 'active', evidenceAssessment: 'deferred' },
      { alarmId: null, incidentId },
      'opaque+/cursor',
    ),
    `/api/v1/alarm-incident-center?automaticState=active&severity=critical&evidenceAssessment=deferred&incidentId=${incidentId}&cursor=opaque%2B%2Fcursor&limit=25`,
  );
});

test('automatic alarm, human incident, severity, and evidence states never depend on color alone', () => {
  for (const state of ['information', 'advisory', 'warning', 'critical'] as const) {
    const value = severityPresentation(state);
    assert.ok(value.icon && value.label && value.value);
  }
  for (const state of ['active', 'cleared'] as const) {
    const value = automaticStatePresentation(state);
    assert.ok(value.icon && value.label && value.value);
  }
  for (const state of [
    null,
    'open',
    'acknowledged',
    'investigating',
    'resolved',
    'closed',
  ] as const) {
    const value = incidentStatePresentation(state);
    assert.ok(value.icon && value.label && value.value);
  }
  for (const state of ['assessable', 'unassessable', 'missing', 'pending', 'deferred'] as const) {
    const value = evidencePresentation(state);
    assert.ok(value.icon && value.label && value.value);
  }
  assert.equal(formatAlarmCenterMicros('1234567'), '1,234,567 µs');
  assert.equal(formatAlarmCenterMicros(null), '—');
});

test('known server capability and conflict messages map to typed localized vocabulary', () => {
  assert.equal(
    capabilityDisabledReasonKey('Investigation and automatic clear are required.'),
    'alarmCapabilityResolveState',
  );
  assert.equal(actionErrorKey('The incident conflicts with governed history.'), 'alarmApiConflict');
  assert.equal(capabilityDisabledReasonKey('Unrecognized server reason.'), null);
  assert.equal(actionErrorKey('Unrecognized server error.'), null);
});
