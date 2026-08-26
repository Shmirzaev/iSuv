import { strict as assert } from 'node:assert';
import test from 'node:test';

import type {
  LiveOperationsInspector as LiveOperationsInspectorResponse,
  LiveOperationsResponse,
} from '@isuv/contracts';
import { renderToStaticMarkup } from 'react-dom/server';

import { LiveOperationsContent, LiveOperationsInspector } from './live-operations.js';

const id = {
  territory: 'a2000000-0000-4000-8000-000000000001',
  waterway: 'a2000000-0000-4000-8000-000000000002',
  section: 'a2000000-0000-4000-8000-000000000003',
  station: 'b2000000-0000-4000-8000-000000000001',
  device: 'c2000000-0000-4000-8000-000000000001',
  installation: 'c2000000-0000-4000-8000-000000000002',
  sensor: 'c2000000-0000-4000-8000-000000000003',
};
const source = {
  kind: 'synthetic_scenario' as const,
  label: 'Synthetic fixture',
  official: false,
  provenance: 'synthetic:test',
};
const canonicalSource = {
  kind: 'canonical_observation' as const,
  label: 'Governed canonical test',
  official: false,
  provenance: 'synthetic:governed canonical test',
};
const quantity = (
  kind: 'stage' | 'discharge' | 'accumulated_volume',
  unit: 'm' | 'm3/s' | 'm3',
) => ({
  sensorId: id.sensor,
  kind,
  value: '1.25',
  unit,
  dataState: 'reported' as const,
  quality: 'valid' as const,
  observedAt: '2026-08-24T07:34:56.123456Z',
  ingestedAt: '2026-08-24T07:34:57.123456Z',
  revision: 1,
  lineageId: id.sensor,
  observationId: id.sensor,
  workflow: 'synthetic_scenario' as const,
  qualityReason: null,
  uncertainty: null,
  uncertaintyMethod: null,
  measurementMethod: null,
  calibrationRef: null,
  ratingCurveRef: null,
  source,
});
const unconfigured = {
  state: 'unconfigured' as const,
  source: 'unconfigured' as const,
  reason: 'No approved governed source.',
};
const response: LiveOperationsResponse = {
  referenceAt: '2026-08-24T07:34:56.123456Z',
  knownAt: '2026-08-24T07:35:00.123456Z',
  presentationTimeZone: 'Asia/Tashkent',
  scenario: {
    id: 'd5000000-0000-4000-8000-000000000001',
    version: 1,
    provenance: 'immutable synthetic fixture',
    dataClassification: 'synthetic',
    officialTelemetry: false,
  },
  scope: { stationDenominator: 83, deviceDenominator: 83 },
  facets: {
    territories: [
      {
        id: id.territory,
        name: 'Synthetic district',
        code: 'SYN-D',
        depth: 1,
        path: [id.territory],
      },
    ],
    waterways: [{ id: id.waterway, name: 'Synthetic canal', code: 'SYN-C' }],
    sections: [{ id: id.section, name: 'Section 1', code: 'S1' }],
    stations: [{ id: id.station, name: 'Station 1', code: 'ST1' }],
    devices: [{ id: id.device, name: 'Device 1', code: 'DV1' }],
    measurementKinds: ['stage', 'discharge', 'accumulated_volume'],
    connections: ['communicating'],
    faults: ['none'],
    dataStates: ['reported', 'no_data', 'unreliable'],
    qualities: ['unknown', 'valid', 'suspect', 'invalid', 'estimated'],
    attentions: ['reported', 'no_data', 'unreliable', 'attention'],
  },
  rows: [
    {
      deviceId: id.device,
      stationId: id.station,
      territory: { id: id.territory, name: 'Synthetic district', code: 'SYN-D' },
      waterway: {
        id: id.waterway,
        name: 'Synthetic canal',
        sectionId: id.section,
        sectionName: 'Section 1',
      },
      station: { code: 'S-01', name: 'Synthetic Station 01' },
      device: {
        code: 'D-01',
        name: 'Synthetic Device 01',
        protocol: 'synthetic',
        installationId: id.installation,
        installationProvenance: 'synthetic installation',
      },
      quantities: {
        stage: quantity('stage', 'm'),
        discharge: quantity('discharge', 'm3/s'),
        accumulatedCounter: quantity('accumulated_volume', 'm3'),
      },
      health: {
        connection: 'communicating',
        fault: 'none',
        faultCode: null,
        dataCondition: 'current',
        freshness: 'unconfigured',
        lastSeenReceivedAt: '2026-08-24T07:34:57.123456Z',
        lastObservedAt: '2026-08-24T07:34:56.123456Z',
        ageMicroseconds: '1000000',
        power: { state: 'measured', value: '12.2', unit: 'V' },
        signal: { state: 'measured', value: '-70', unit: 'dBm' },
        source,
      },
      governed: {
        plan: unconfigured,
        intervalVariance: unconfigured,
        waterStatus: unconfigured,
        calibrationDue: unconfigured,
        alarm: unconfigured,
        incident: unconfigured,
      },
      attention: {
        state: 'reported',
        label: 'Reported',
        icon: 'check-circle',
        value: 'Synthetic scenario',
      },
      synthetic: true,
      provenance: 'synthetic:test',
    },
  ],
  nextCursor: 'opaque-next',
};

test('live table renders full labels, explicit units/statuses, safe placeholders, filters, and device hash drill', () => {
  const markup = renderToStaticMarkup(
    <LiveOperationsContent
      locale="en"
      response={response}
      filters={{}}
      onFiltersChange={() => undefined}
      onClearFilters={() => undefined}
      onSelect={() => undefined}
    />,
  );
  for (const label of [
    'Station',
    'Device',
    'Waterway / section',
    'Stage',
    'Discharge',
    'Accumulated counter',
    'Plan',
    'Interval variance',
    'Data quality',
    'Water and device status',
    'Data age',
    'Power / signal',
    'Calibration',
    'Alarm / incident',
  ])
    assert.match(markup, new RegExp(label));
  assert.match(markup, /1\.25 m<\/strong>/);
  assert.match(markup, /1\.25 m³\/s<\/strong>/);
  assert.match(markup, /1\.25 m³<\/strong>/);
  assert.match(markup, /Not configured/);
  assert.match(markup, /Synthetic scenario \/ non-official source/);
  assert.match(markup, /href="#operations\?deviceId=c2000000/);
  assert.match(markup, /<form[^>]+aria-label="Filters"/);
  assert.match(markup, /<select[^>]+id="live-filter-liveTerritory"/);
});

test('device health exposes independent offline, fault, current, stale, and no-data facts with text, icons, and values', () => {
  const base = response.rows[0]!;
  const healthResponse: LiveOperationsResponse = {
    ...response,
    rows: [
      base,
      {
        ...base,
        deviceId: 'c2000000-0000-4000-8000-000000000010',
        health: {
          ...base.health,
          connection: 'offline',
          fault: 'reported',
          faultCode: 'SYNTHETIC_FAULT',
          dataCondition: 'stale',
        },
        attention: {
          state: 'attention',
          label: 'Attention',
          icon: 'warning',
          value: 'Action required',
        },
      },
      {
        ...base,
        deviceId: 'c2000000-0000-4000-8000-000000000011',
        health: {
          ...base.health,
          connection: 'unknown',
          fault: 'unknown',
          faultCode: null,
          dataCondition: 'no_data',
        },
        attention: {
          state: 'no_data',
          label: 'No data',
          icon: 'minus-circle',
          value: 'No observation reported',
        },
      },
    ],
  };
  const markup = renderToStaticMarkup(
    <LiveOperationsContent
      locale="en"
      response={healthResponse}
      filters={{}}
      onFiltersChange={() => undefined}
      onClearFilters={() => undefined}
      onSelect={() => undefined}
    />,
  );
  for (const visibleState of [
    'Connection: Communicating',
    'Device fault: No fault reported',
    'Data state: Current data condition',
    'Connection: Offline',
    'Device fault: Device fault / unreliable',
    'Device fault: SYNTHETIC_FAULT',
    'Data state: Stale data condition',
    'Connection: Unknown',
    'Device fault: Unknown',
    'Data state: No data',
  ])
    assert.match(markup, new RegExp(visibleState));
  assert.equal((markup.match(/aria-hidden="true"/g) ?? []).length > 12, true);
  assert.equal((markup.match(/data-health-state=/g) ?? []).length, 9);
  assert.equal((markup.match(/<details class="live-health-disclosure">/g) ?? []).length, 3);
  assert.match(
    markup,
    /aria-label="Water and device status: Reported; Device health: Communicating · No fault reported · Current data condition; Not configured"/,
  );
});

test('a valid empty filtered result retains the filters and clear action', () => {
  const emptyResponse = { ...response, rows: [] };
  const markup = renderToStaticMarkup(
    <LiveOperationsContent
      locale="en"
      response={emptyResponse}
      filters={{ quality: 'estimated' }}
      onFiltersChange={() => undefined}
      onClearFilters={() => undefined}
      onSelect={() => undefined}
    />,
  );
  assert.match(markup, /aria-label="Filters"/);
  assert.match(markup, />Clear filters<\/button>/);
  assert.match(markup, /<table class="live-table">/);
});

test('persistent inspector gives the heading focus target, raw/validated trend table, and explicit placeholders', () => {
  const inspector: LiveOperationsInspectorResponse = {
    referenceAt: response.referenceAt,
    knownAt: response.knownAt,
    current: {
      ...response.rows[0]!,
      quantities: {
        ...response.rows[0]!.quantities,
        stage: {
          ...response.rows[0]!.quantities.stage,
          revision: 2,
          lineageId: id.sensor,
          observationId: id.device,
          workflow: 'automatically_validated' as const,
          source: canonicalSource,
        },
      },
    },
    trend: [
      {
        at: response.referenceAt,
        kind: 'discharge' as const,
        raw: '1.2',
        validated: '1.1',
        unit: 'm3/s' as const,
        gap: false,
        source,
      },
      {
        at: response.knownAt,
        kind: 'discharge' as const,
        raw: null,
        validated: null,
        unit: 'm3/s' as const,
        gap: true,
        source,
      },
    ],
    revisions: [
      {
        observationId: id.installation,
        lineageId: id.sensor,
        revision: 1,
        workflow: 'raw',
        quality: 'unknown' as const,
        value: '1.20',
        unit: 'm' as const,
        observedAt: response.referenceAt,
        ingestedAt: response.knownAt,
        reason: 'Awaiting validation',
        source: canonicalSource,
      },
      {
        observationId: id.device,
        lineageId: id.sensor,
        revision: 2,
        workflow: 'automatically_validated',
        quality: 'valid' as const,
        value: '1.25',
        unit: 'm' as const,
        observedAt: response.referenceAt,
        ingestedAt: response.knownAt,
        reason: null,
        source: canonicalSource,
      },
    ],
    healthHistory: unconfigured,
    maintenance: {
      state: 'synthetic_history',
      source: 'synthetic_scenario',
      reason: null,
      records: [
        {
          id: 'c2000000-0000-4000-8000-000000000012',
          version: 1,
          organizationId: id.territory,
          territoryId: id.territory,
          deviceId: id.device,
          type: 'calibration',
          status: 'completed',
          scheduledInterval: {
            start: '2026-08-22T07:00:00.000000Z',
            end: '2026-08-22T08:00:00.000000Z',
          },
          startedAt: '2026-08-22T07:05:00.000000Z',
          completedAt: '2026-08-22T07:45:00.000000Z',
          recordedAt: '2026-08-22T08:00:00.000000Z',
          createdAt: '2026-08-22T06:00:00.000000Z',
          auditEventId: 'c2000000-0000-4000-8000-000000000013',
          provenance: 'synthetic seeded maintenance history',
          dataClassification: 'synthetic',
          officialRecord: false,
        },
      ],
    },
    placeholders: {
      plan: 'unconfigured' as const,
      intervalVariance: 'unconfigured' as const,
      alarms: 'unconfigured' as const,
      incidents: 'unconfigured' as const,
      firmware: 'unconfigured' as const,
      documents: 'unconfigured' as const,
    },
  };
  const markup = renderToStaticMarkup(
    <LiveOperationsInspector locale="en" inspector={inspector} onClose={() => undefined} />,
  );
  assert.match(markup, /id="live-inspector-c2000000[^>]+tabindex="-1"/);
  assert.match(markup, /24-hour raw and validated trend/);
  assert.match(markup, /Raw/);
  assert.match(markup, /Validated/);
  assert.match(markup, /Gap/);
  assert.match(markup, /Current raw and validated state/);
  assert.match(markup, /Measurement, calibration, and rating metadata/);
  assert.match(markup, /Governed canonical test/);
  assert.match(markup, /Non-official source/);
  assert.match(markup, /Revision 1; 1\.20 m; Workflow: raw/);
  assert.match(markup, /Revision 2; 1\.25 m; Workflow: automatically_validated/);
  assert.match(markup, /Not configured/);
  assert.match(markup, /Maintenance history/);
  assert.match(markup, /Calibration — Completed/);
  assert.match(markup, /Scheduled interval/);
  assert.match(markup, /Actual start \/ completion/);
  assert.match(markup, /Recorded at/);
  assert.match(markup, /Audit evidence identifier/);
  assert.match(markup, /c2000000-0000-4000-8000-000000000013/);
  assert.match(markup, /synthetic seeded maintenance history/);
  assert.match(markup, /Synthetic, non-official maintenance record/);
  assert.doesNotMatch(markup, /work order|control device/i);
});

test('unconfigured maintenance is visibly distinct from an empty synthetic history', () => {
  const inspector: LiveOperationsInspectorResponse = {
    referenceAt: response.referenceAt,
    knownAt: response.knownAt,
    current: response.rows[0]!,
    trend: [],
    revisions: [],
    healthHistory: unconfigured,
    maintenance: {
      state: 'unconfigured',
      records: [],
      source: 'unconfigured',
      reason: 'No synthetic maintenance history is configured for this device.',
    },
    placeholders: {
      plan: 'unconfigured',
      intervalVariance: 'unconfigured',
      alarms: 'unconfigured',
      incidents: 'unconfigured',
      firmware: 'unconfigured',
      documents: 'unconfigured',
    },
  };
  const markup = renderToStaticMarkup(
    <LiveOperationsInspector locale="en" inspector={inspector} onClose={() => undefined} />,
  );
  assert.match(markup, /Maintenance history/);
  assert.match(markup, /No synthetic maintenance history is configured for this device\./);
  assert.match(markup, /Not configured/);
});
