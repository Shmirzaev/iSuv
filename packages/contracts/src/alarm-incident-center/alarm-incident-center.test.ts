import assert from 'node:assert/strict';
import test from 'node:test';
import {
  alarmIncidentCenterQuerySchema,
  alarmIncidentCenterResponseSchema,
} from './alarm-incident-center.js';

test('alarm incident center query is strict and bounded', () => {
  assert.equal(alarmIncidentCenterQuerySchema.parse({}).limit, 25);
  assert.equal(alarmIncidentCenterQuerySchema.safeParse({ limit: 51 }).success, false);
  assert.equal(alarmIncidentCenterQuerySchema.safeParse({ forged: 'caller-state' }).success, false);
  assert.equal(
    alarmIncidentCenterQuerySchema.safeParse({
      alarmId: '12000000-0000-4000-8000-000000000001',
      incidentId: '12000000-0000-4000-8000-000000000002',
    }).success,
    false,
  );
});
test('center response never conflates automatic and human lifecycle fields', () => {
  const value = {
    referenceAt: '2030-01-01T00:00:00.000000Z',
    knownAt: '2030-01-01T00:00:00.000000Z',
    presentationTimeZone: 'Asia/Tashkent',
    scope: { territoryId: '12000000-0000-4000-8000-000000000001', queueDenominator: 1 },
    assignmentCandidates: [],
    nextCursor: null,
    panel: null,
    scenario: {
      dataClassification: 'synthetic',
      officialComplianceEligible: false,
      label: 'synthetic',
    },
    items: [
      {
        alarmId: '12000000-0000-4000-8000-000000000002',
        incidentId: '12000000-0000-4000-8000-000000000003',
        territory: { id: '12000000-0000-4000-8000-000000000001', code: 'X', name: 'X' },
        eventType: 'high_stage',
        severity: 'warning',
        automaticState: 'cleared',
        incidentStatus: 'investigating',
        waterCondition: 'high_stage',
        systemDeviceCondition: 'not_assessed',
        detectedAt: '2030-01-01T00:00:00.000000Z',
        clearedAt: '2030-01-01T00:01:00.000000Z',
        assignedUserId: null,
        evidence: {
          assessment: 'unassessable',
          effectiveAt: null,
          knownAt: null,
          detectedAt: '2030-01-01T00:00:00.000000Z',
          signalRunId: null,
          latestEvidenceStatus: null,
          result: null,
          reason: null,
          qualityState: 'valid',
          qualityReason: null,
          ruleId: '12000000-0000-4000-8000-000000000004',
          catalogVersionId: '12000000-0000-4000-8000-000000000005',
          unitBoundary: 'stage_m',
          provenance: {
            dataClassification: 'synthetic',
            officialComplianceEligible: false,
            label: 'synthetic',
          },
        },
        escalation: {
          state: 'unconfigured',
          tier: null,
          procedure: null,
          acknowledgementDueAt: null,
          resolutionDueAt: null,
          acknowledgementElapsedMicroseconds: null,
          resolutionElapsedMicroseconds: null,
          provenance: null,
        },
        capabilities: Object.fromEntries(
          [
            'createIncident',
            'acknowledge',
            'investigate',
            'assign',
            'comment',
            'correctiveAction',
            'resolve',
            'close',
          ].map((x) => [x, { allowed: false, disabledReason: 'test' }]),
        ),
        provenance: {
          dataClassification: 'synthetic',
          officialComplianceEligible: false,
          label: 'synthetic',
        },
      },
    ],
  };
  assert.equal(
    alarmIncidentCenterResponseSchema.parse(value).items[0]?.incidentStatus,
    'investigating',
  );
});
