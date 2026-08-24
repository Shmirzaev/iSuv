import { strict as assert } from 'node:assert';
import test from 'node:test';

import { translations } from '@isuv/i18n';

import {
  dashboardAssessmentPresentation,
  dashboardDataStatePresentation,
  dashboardPath,
  dashboardPeriods,
  formatDashboardTimestamp,
  formatExactRational,
  periodKey,
} from './dashboard-model.js';

test('all dashboard periods map to server-composed requests and localized control labels', () => {
  for (const period of dashboardPeriods) {
    assert.equal(dashboardPath(period), `/api/v1/dashboard?period=${period}`);
    const key = periodKey(period);
    assert.ok(translations.uz[key].length > 0);
    assert.ok(translations.ru[key].length > 0);
    assert.ok(translations.en[key].length > 0);
  }
});

test('dashboard status states always retain a readable label and icon', () => {
  for (const state of ['scenario_classified', 'unassessable', 'unconfigured'] as const) {
    const presentation = dashboardAssessmentPresentation(state);
    assert.ok(presentation.icon.length > 0);
    for (const locale of ['uz', 'ru', 'en'] as const)
      assert.ok(translations[locale][presentation.label].length > 0);
  }
  assert.deepEqual(dashboardDataStatePresentation('unreliable'), {
    icon: '!',
    label: 'statusUnreliable',
  });
});

test('exact volume and percentage values are not rounded through Number', () => {
  assert.equal(
    formatExactRational({ numerator: '900719925474099312346', denominator: '3' }),
    '900719925474099312346 / 3',
  );
  assert.equal(formatExactRational({ numerator: '100', denominator: '2' }), '50');
  assert.equal(formatExactRational({ numerator: '-2', denominator: '4' }), '-0.5');
  assert.equal(
    formatDashboardTimestamp('2026-08-24T07:34:56.123456Z'),
    '2026-08-24 07:34:56.123456 UTC',
  );
});
