import { strict as assert } from 'node:assert';
import test from 'node:test';

import { formatDecimal, formatMeasurementValue, presentationTimestamp } from './format.js';

test('formats exact decimal strings with locale grouping without precision loss', () => {
  assert.equal(
    formatDecimal('en', '9007199254740993123456.0100'),
    '9,007,199,254,740,993,123,456.0100',
  );
  assert.equal(formatDecimal('en', '-408200'), '-408,200');
  assert.equal(formatDecimal('ru', '408200.5'), '408 200,5');
});

test('presents timestamps in Tashkent at second precision while retaining raw UTC evidence', () => {
  const timestamp = presentationTimestamp('en', '2026-08-30T11:57:06.830442Z');
  assert.equal(timestamp.dateTime, '2026-08-30T11:57:06.830Z');
  assert.equal(timestamp.title, '2026-08-30T11:57:06.830442Z');
  assert.match(timestamp.value, /(?:30 Aug 2026|Aug 30, 2026), 16:57:06/);
});

test('formats stage, discharge, and accumulated volume at their distinct operational precision', () => {
  assert.equal(formatMeasurementValue('en', '1.010000', 'm'), '1.01');
  assert.equal(formatMeasurementValue('en', '1250.256', 'm3/s'), '1,250.26');
  assert.equal(
    formatMeasurementValue('en', '9007199254740993123456.5', 'm3'),
    '9,007,199,254,740,993,123,457',
  );
  assert.equal(formatMeasurementValue('ru', '2100', 'm3'), '2 100');
});
