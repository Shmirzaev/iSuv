import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createIncidentRequestSchema,
  requestEscalationPolicyVersionRequestSchema,
} from './incidents.js';

test('incident and escalation authoring contracts reject client lifecycle state and timestamps', () => {
  assert.equal(
    createIncidentRequestSchema.safeParse({
      alarmId: '00000000-0000-4000-8000-000000000001',
      reason: 'synthetic operator case',
    }).success,
    true,
  );
  assert.equal(
    createIncidentRequestSchema.safeParse({
      alarmId: '00000000-0000-4000-8000-000000000001',
      reason: 'synthetic operator case',
      status: 'closed',
    }).success,
    false,
  );
  const version = {
    effectiveFrom: '2030-01-01T00:00:00.000000Z',
    effectiveUntil: '2030-01-02T00:00:00.000000Z',
    tier: 1,
    procedure: 'synthetic procedure',
    acknowledgementTargetMicroseconds: '1000000',
    resolutionTargetMicroseconds: '2000000',
    reason: 'govern synthetic policy',
  };
  assert.equal(requestEscalationPolicyVersionRequestSchema.safeParse(version).success, true);
  assert.equal(
    requestEscalationPolicyVersionRequestSchema.safeParse({
      ...version,
      requestedAt: version.effectiveFrom,
    }).success,
    false,
  );
  assert.equal(
    requestEscalationPolicyVersionRequestSchema.safeParse({
      ...version,
      effectiveUntil: version.effectiveFrom,
    }).success,
    false,
  );
  assert.equal(
    requestEscalationPolicyVersionRequestSchema.safeParse({
      ...version,
      effectiveFrom: '2030-01-01T05:00:00.000001+05:00',
      effectiveUntil: '2030-01-01T00:00:00.000000Z',
    }).success,
    false,
  );
  for (const acknowledgementTargetMicroseconds of ['0', '31536000000001'])
    assert.equal(
      requestEscalationPolicyVersionRequestSchema.safeParse({
        ...version,
        acknowledgementTargetMicroseconds,
      }).success,
      false,
    );
});
