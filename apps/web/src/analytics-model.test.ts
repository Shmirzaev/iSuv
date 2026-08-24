import { strict as assert } from 'node:assert';
import test from 'node:test';
import { translations } from '@isuv/i18n';
import {
  analyticsFiltersFromHash,
  analyticsHash,
  analyticsPath,
  analyticsPeriods,
} from './analytics-model.js';

test('analytics URL state accepts only complete known filters and produces server paths', () => {
  const id = 'a6000000-0000-4000-8000-000000000001';
  const filters = analyticsFiltersFromHash(`#analytics?period=season&facet=basin&facetId=${id}`);
  assert.deepEqual(filters, { period: 'season', facet: 'basin', facetId: id });
  assert.equal(analyticsHash(filters), `#analytics?period=season&facet=basin&facetId=${id}`);
  assert.equal(analyticsPath(filters), `/api/v1/analytics?period=season&facet=basin&facetId=${id}`);
  assert.deepEqual(analyticsFiltersFromHash('#analytics?period=oops&facet=basin'), {
    period: 'today',
  });
});

test('analytics filter and state vocabulary has tri-language labels', () => {
  for (const locale of ['en', 'ru', 'uz'] as const) {
    for (const key of [
      'analyticsHeading',
      'analyticsDelivery',
      'analyticsBalance',
      'analyticsQuality',
      'analyticsAvailability',
      'analyticsUnassessable',
      'analyticsCadenceUnconfigured',
    ] as const)
      assert.ok(translations[locale][key].length > 0);
  }
  assert.deepEqual(analyticsPeriods, ['today', 'week', 'month', 'season', 'year']);
});
