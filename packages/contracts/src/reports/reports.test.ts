import assert from 'node:assert/strict';
import test from 'node:test';
import { generateReportRequestSchema } from './reports.js';
test('report generation accepts only governed selectors', () => {
  assert.equal(
    generateReportRequestSchema.safeParse({ kind: 'daily_situation', payload: {} }).success,
    false,
  );
  assert.equal(generateReportRequestSchema.safeParse({ kind: 'incident' }).success, false);
  assert.equal(
    generateReportRequestSchema.safeParse({
      kind: 'daily_situation',
      incidentId: '00000000-0000-4000-8000-000000000001',
    }).success,
    false,
  );
});
