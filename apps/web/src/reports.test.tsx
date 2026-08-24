import { strict as assert } from 'node:assert';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReportSnapshot } from '@isuv/contracts';
import { ReportSnapshotDetail, ReportTemplateForm, ReportsWorkspace } from './reports.js';

const id = 'a6000000-0000-4000-8000-000000000001';
const report: ReportSnapshot = {
  id,
  organizationId: 'a6000000-0000-4000-8000-000000000002',
  territoryId: 'a6000000-0000-4000-8000-000000000003',
  kind: 'water_balance',
  version: 1,
  period: 'today',
  facet: null,
  facetId: null,
  incidentId: null,
  referenceAt: '2026-08-24T00:00:00.000000Z',
  knownAt: '2026-08-24T00:00:00.000000Z',
  presentationTimeZone: 'Asia/Tashkent',
  method: { id: 'governed_report_snapshot_v1', version: 1 },
  qualityState: 'deferred',
  approvalStatus: 'generated_not_approved',
  generatedByUserId: 'a6000000-0000-4000-8000-000000000004',
  generatedAt: '2026-08-24T00:00:01.000000Z',
  provenance: {
    dataClassification: 'synthetic',
    officialComplianceEligible: false,
    label: 'Immutable synthetic report scenario',
  },
  caveats: [
    'Synthetic governed accounting evidence.',
    'No approved accounting assumption is available.',
  ],
  sourceSnapshot: {
    analyticsScenarioId: 'a6000000-0000-4000-8000-000000000005',
    analyticsScenarioVersion: 1,
    sourceRevisionPolicy: 'known_at_frozen',
  },
  fingerprint: 'a'.repeat(64),
  payload: {
    reportKind: 'water_balance',
    context: {
      referenceAt: '2026-08-24T00:00:00.000000Z',
      analyticsKnownAt: '2026-08-24T00:00:00.000000Z',
      reportKnownAt: '2026-08-24T00:00:00.000000Z',
      presentationTimeZone: 'Asia/Tashkent',
      scope: {
        territoryId: 'a6000000-0000-4000-8000-000000000003',
        facet: null,
        facetId: null,
        stationDenominator: 83,
        deviceDenominator: 83,
      },
      scenario: {
        id: 'a6000000-0000-4000-8000-000000000005',
        version: 1,
        method: 'governed_p3_composition_v1',
        provenance: 'immutable governed synthetic composition',
        synthetic: true,
        officialComplianceEligible: false,
        forecast: false,
      },
    },
    content: {
      balance: {
        outcome: 'deferred',
        deferReason: 'no_approved_water_balance_model',
        junctionId: 'a6000000-0000-4000-8000-000000000006',
        modelId: null,
        versionId: null,
        interval: {
          start: '2026-08-23T19:00:00.000000Z',
          end: '2026-08-24T00:00:00.000000Z',
        },
        knownAt: '2026-08-24T00:00:00.000000Z',
        components: [],
        incomingM3: null,
        outgoingM3: null,
        knownAdditionM3: null,
        knownRemovalM3: null,
        storageChangeM3: null,
        assumptionId: null,
        assumptionProvenance: null,
        residualM3: null,
        provenance: 'governed synthetic balance',
        dataClassification: 'synthetic',
        officialComplianceEligible: false,
        alarmEligible: false,
      },
    },
    limitations: {
      measurementUncertainty: 'measurement_uncertainty_unavailable',
      interpretation:
        'Synthetic decision support only. No official accounting, loss/theft inference, forecast, or physical-control advice.',
    },
  },
};

test('frozen report detail discloses immutable metadata, caveats, units and status without forbidden inference', () => {
  const markup = renderToStaticMarkup(
    <ReportSnapshotDetail
      exportMessage={null}
      exportState="idle"
      locale="en"
      onClose={() => undefined}
      onExport={() => undefined}
      report={report}
    />,
  );
  for (const text of [
    'Frozen report detail',
    'Generated — not approved',
    'Reference cutoff',
    'Known-data cutoff',
    'Frozen source snapshot',
    'Measurement uncertainty is unavailable',
    'cadence is unconfigured',
    'Synthetic and non-official',
    'm³/s',
    'm³',
    '<table',
  ])
    assert.match(markup, new RegExp(text));
  assert.doesNotMatch(
    markup,
    /control gate|send notification|create work order|operate pump|operate valve/i,
  );
  assert.match(markup, new RegExp(`href="#reports\\?reportId=${id}"`));
});

test('native generation controls keep incident identifier exclusive to per-incident reports', () => {
  const base = { kind: 'daily_situation' as const, period: 'today' as const, incidentId: '' };
  const standard = renderToStaticMarkup(
    <ReportTemplateForm
      busy={false}
      filters={base}
      locale="en"
      onChange={() => undefined}
      onGenerate={() => undefined}
    />,
  );
  assert.match(standard, /<select/);
  assert.match(standard, /id="reports-generate"/);
  assert.doesNotMatch(standard, /id="reports-incident-id"/);
  for (const template of [
    'Daily situation',
    'Allocation compliance',
    'Water balance',
    'Device availability',
    'Per-incident',
    'Executive summary',
  ])
    assert.match(standard, new RegExp(template));
  const incident = renderToStaticMarkup(
    <ReportTemplateForm
      busy={false}
      filters={{ ...base, kind: 'incident' }}
      locale="en"
      onChange={() => undefined}
      onGenerate={() => undefined}
    />,
  );
  assert.match(incident, /id="reports-incident-id"/);
  assert.match(incident, /required=""/);
});

test('loading and unavailable reports never render stale report values', () => {
  const loading = renderToStaticMarkup(<ReportsWorkspace access="unavailable" locale="en" />);
  assert.match(loading, /Loading reports/);
  assert.doesNotMatch(loading, /Immutable synthetic report scenario/);
});
