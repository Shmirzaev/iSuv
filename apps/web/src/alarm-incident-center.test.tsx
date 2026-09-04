import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AlarmIncidentCenterResponse } from '@isuv/contracts';
import { translations } from '@isuv/i18n';

import { AlarmCenterPanel, AlarmCenterQueue } from './alarm-incident-center.js';

const response: AlarmIncidentCenterResponse = {
  referenceAt: '2026-08-24T00:00:00.000Z',
  knownAt: '2026-08-24T00:00:00.000Z',
  presentationTimeZone: 'Asia/Tashkent',
  scope: { territoryId: 'a2000000-0000-4000-8000-000000000001', queueDenominator: 1 },
  scenario: {
    dataClassification: 'synthetic',
    officialComplianceEligible: false,
    label: 'Synthetic alarm scenario',
  },
  nextCursor: null,
  assignmentCandidates: [{ id: 'b2000000-0000-4000-8000-000000000001', displayName: 'Operator' }],
  items: [],
  panel: null,
};
const item: NonNullable<AlarmIncidentCenterResponse['panel']>['item'] = {
  alarmId: 'c2000000-0000-4000-8000-000000000001',
  incidentId: 'd2000000-0000-4000-8000-000000000001',
  territory: { id: 'a2000000-0000-4000-8000-000000000001', code: 'SYN', name: 'Synthetic basin' },
  eventType: 'high_stage',
  severity: 'critical',
  automaticState: 'active',
  incidentStatus: 'investigating',
  waterCondition: 'high_stage',
  systemDeviceCondition: 'not_assessed',
  detectedAt: '2026-08-24T00:00:00.000Z',
  clearedAt: null,
  assignedUserId: null,
  evidence: {
    assessment: 'deferred',
    effectiveAt: null,
    knownAt: null,
    detectedAt: '2026-08-24T00:00:00.000Z',
    signalRunId: null,
    latestEvidenceStatus: null,
    result: { value: 2.1, unit: 'm' },
    reason: 'Synthetic deferred signal',
    qualityState: 'unavailable',
    qualityReason: 'Synthetic quality unavailable',
    ruleId: 'e2000000-0000-4000-8000-000000000001',
    catalogVersionId: 'f2000000-0000-4000-8000-000000000001',
    unitBoundary: 'stage_m',
    provenance: {
      dataClassification: 'synthetic',
      officialComplianceEligible: false,
      label: 'Synthetic evidence',
    },
  },
  escalation: {
    state: 'configured',
    tier: 1,
    procedure: 'Synthetic procedure',
    acknowledgementDueAt: '2026-08-24T01:00:00.000Z',
    resolutionDueAt: '2026-08-24T02:00:00.000Z',
    acknowledgementElapsedMicroseconds: '10',
    resolutionElapsedMicroseconds: '20',
    provenance: 'Synthetic policy',
  },
  capabilities: {
    createIncident: {
      allowed: false,
      disabledReason: 'An incident already exists for this alarm.',
    },
    acknowledge: { allowed: false, disabledReason: 'Already acknowledged.' },
    investigate: { allowed: false, disabledReason: 'Already investigating.' },
    assign: { allowed: true, disabledReason: null },
    comment: { allowed: true, disabledReason: null },
    correctiveAction: { allowed: true, disabledReason: null },
    resolve: { allowed: false, disabledReason: 'Automatic alarm remains active.' },
    close: { allowed: false, disabledReason: 'Incident is not resolved.' },
  },
  provenance: {
    dataClassification: 'synthetic',
    officialComplianceEligible: false,
    label: 'Synthetic alarm',
  },
};
const selectedResponse: AlarmIncidentCenterResponse = {
  ...response,
  items: [
    {
      ...item,
      systemDeviceCondition: 'communication_loss',
      waterCondition: 'under_allocation',
    },
  ],
  panel: {
    item,
    linkedAlarms: [
      {
        alarmId: item.alarmId,
        automaticState: 'active',
        detectedAt: item.detectedAt,
        clearedAt: null,
      },
    ],
    timeline: [
      {
        sequence: 1,
        kind: 'created',
        actorUserId: 'b2000000-0000-4000-8000-000000000001',
        reason: 'Synthetic creation',
        body: null,
        assigneeUserId: null,
        alarmId: null,
        occurredAt: item.detectedAt,
        requestId: 'synthetic-request',
      },
    ],
    metrics: {
      acknowledgement: { state: 'acknowledgement_pending', elapsedMicroseconds: '10', dueAt: null },
      resolution: { state: 'resolution_pending', elapsedMicroseconds: '20', dueAt: null },
    },
  },
};

test('queue and panel keep automatic, human, evidence, quality, unit, and metric state explicit in every locale', () => {
  for (const locale of ['uz', 'ru', 'en'] as const) {
    const queue = renderToStaticMarkup(
      <AlarmCenterQueue
        locale={locale}
        response={selectedResponse}
        selection={{ alarmId: null, incidentId: item.incidentId }}
        onSelect={() => undefined}
      />,
    );
    const panel = renderToStaticMarkup(
      <AlarmCenterPanel
        locale={locale}
        response={selectedResponse}
        onClose={() => undefined}
        onRefresh={() => undefined}
      />,
    );
    for (const key of [
      'alarmAutomaticState',
      'alarmIncidentState',
      'alarmWaterUnderAllocation',
      'alarmSystemCommunicationLoss',
      'alarmWaterCondition',
      'alarmSystemCondition',
      'alarmEvidenceDeferred',
      'alarmUnitStage',
      'alarmImmutableTimeline',
      'alarmLifecycleSeparation',
    ] as const) {
      assert.ok(`${queue}${panel}`.includes(translations[locale][key]), key);
    }
    assert.match(panel, /10 µs/);
    assert.match(panel, /Synthetic quality unavailable/);
    assert.ok(panel.includes(translations[locale].alarmCapabilityExistingIncident));
    if (locale !== 'en')
      assert.equal(panel.includes('An incident already exists for this alarm.'), false);
  }
});

test('renderer retains focus management, native filters, capability-gated mutations, and no alarm-clear control', async () => {
  const source = await readFile(new URL('./alarm-incident-center.tsx', import.meta.url), 'utf8');
  for (const marker of [
    'useRef<HTMLHeadingElement>',
    'heading.current?.focus()',
    'returnFocus.current',
    'onSelection({ alarmId: null, incidentId: null })',
    'disabled={!capability.allowed}',
    'alarmActionReason',
    'corrective-actions',
    'alarmLifecycleSeparation',
    'qualityReason',
    'unitBoundary',
    'textarea',
    'select',
    'FilterPanel',
    'StatusChip',
    'presentationTimestamp',
    'assignmentCandidates',
    'userId.slice(0, 8)',
    'actionErrorKey',
    'onComplete(message)',
    'setRefresh((value) => value + 1)',
    'alarm-center-table__chip',
    'alarm-center-table__row',
  ])
    assert.ok(source.includes(marker), marker);
  assert.equal(source.includes('/clear'), false);
  assert.equal(source.includes('notification'), false);
  assert.equal(source.includes('work-order'), false);
});
