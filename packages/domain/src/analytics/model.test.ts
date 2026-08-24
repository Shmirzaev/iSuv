import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileAnalyticsMembers } from './model.js';

test('analytics reconciliation excludes unassessable members and preserves exact signed arithmetic', () => {
  const value = reconcileAnalyticsMembers([
    {
      condition: 'over',
      planned: { numerator: 10n, denominator: 1n },
      actual: { numerator: 25n, denominator: 2n },
    },
    {
      condition: 'under',
      planned: { numerator: 4n, denominator: 1n },
      actual: { numerator: 3n, denominator: 1n },
    },
    { condition: 'unassessable' },
  ]);
  assert.deepEqual(value.counts, {
    total: 3,
    assessed: 2,
    over: 1,
    within: 0,
    under: 1,
    unassessable: 1,
  });
  assert.equal((value.signedVariance.numerator * 2n) / value.signedVariance.denominator, 3n);
});
