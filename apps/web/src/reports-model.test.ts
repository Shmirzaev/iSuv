import { strict as assert } from 'node:assert';
import test from 'node:test';
import { translations } from '@isuv/i18n';
import {
  navigateReportPrint,
  reportExportPath,
  reportIdFromHash,
  reportKinds,
  reportPath,
  reportsHash,
  reportsListPath,
} from './reports-model.js';

const id = 'a6000000-0000-4000-8000-000000000001';

test('report URLs expose only a valid immutable report identifier and audited endpoints use it', () => {
  assert.equal(reportIdFromHash(`#reports?reportId=${id}`), id);
  assert.equal(reportIdFromHash('#reports?reportId=not-an-id'), null);
  assert.equal(reportIdFromHash('#analytics?reportId=' + id), null);
  assert.equal(reportsHash(id), `#reports?reportId=${id}`);
  assert.equal(reportsHash(null), '#reports');
  assert.equal(reportsListPath(), '/api/v1/reports');
  assert.equal(reportPath(id), `/api/v1/reports/${id}`);
  assert.equal(reportExportPath(id), `/api/v1/reports/${id}/export`);
});

test('blocked print previews fall back to a same-tab printable document', () => {
  let currentUrl = '';
  const current = {
    closed: false,
    location: { assign: (url: string) => (currentUrl = url) },
  };
  assert.equal(navigateReportPrint(null, current, 'blob:printable-report'), 'same-tab');
  assert.equal(currentUrl, 'blob:printable-report');

  let previewUrl = '';
  const preview = {
    closed: false,
    location: { assign: (url: string) => (previewUrl = url) },
  };
  assert.equal(navigateReportPrint(preview, current, 'blob:preview-report'), 'preview');
  assert.equal(previewUrl, 'blob:preview-report');
});

test('the six report templates and their vocabulary are complete in all locales', () => {
  assert.deepEqual(reportKinds, [
    'daily_situation',
    'allocation_compliance',
    'water_balance',
    'device_availability',
    'incident',
    'executive_summary',
  ]);
  for (const locale of ['en', 'ru', 'uz'] as const)
    for (const key of [
      'reportsHeading',
      'reportsTemplates',
      'reportsVersion',
      'reportsReferenceAt',
      'reportsKnownAt',
      'reportsSourceSnapshot',
      'reportsUncertaintyUnavailable',
      'reportsCsv',
      'reportsPrint',
      'reportKindExecutiveSummary',
    ] as const)
      assert.ok(translations[locale][key].length > 0);
});
