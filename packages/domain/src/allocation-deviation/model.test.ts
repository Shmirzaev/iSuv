import assert from 'node:assert/strict';
import test from 'node:test';
import { rational } from '../quantity-derivation/model.js';
import { evaluateAllocationDeviation } from './model.js';
const tolerance = {
  underAbsoluteM3: '10',
  overAbsoluteM3: '10',
  underPercent: '5',
  overPercent: '5',
  combination: 'any' as const,
  appliesToZeroPlan: false,
};
test('allocation deviation is exact at tolerance boundaries and never uses float rounding', () => {
  assert.equal(evaluateAllocationDeviation('100', rational(105n), tolerance).condition, 'within');
  assert.equal(
    evaluateAllocationDeviation('100', rational(105000001n, 1000000n), tolerance).condition,
    'over',
  );
  assert.equal(evaluateAllocationDeviation('100', rational(95n), tolerance).condition, 'within');
  assert.equal(
    evaluateAllocationDeviation('100', rational(94999999n, 1000000n), tolerance).condition,
    'under',
  );
});
test('zero plan has no percentage and requires explicit zero-plan policy', () => {
  const unassessable = evaluateAllocationDeviation('0', rational(1n), tolerance);
  assert.equal(unassessable.percent, null);
  assert.equal(unassessable.condition, 'unassessable');
  assert.equal(
    evaluateAllocationDeviation('0', rational(11n), { ...tolerance, appliesToZeroPlan: true })
      .condition,
    'over',
  );
  assert.equal(
    evaluateAllocationDeviation('0', rational(1n), {
      ...tolerance,
      overAbsoluteM3: null,
      appliesToZeroPlan: true,
    }).condition,
    'unassessable',
  );
});
test('all combination requires every configured limit to be strictly exceeded', () => {
  assert.equal(
    evaluateAllocationDeviation('100', rational(106n), { ...tolerance, combination: 'all' })
      .condition,
    'within',
  );
  assert.equal(
    evaluateAllocationDeviation('100', rational(111n), { ...tolerance, combination: 'all' })
      .condition,
    'over',
  );
});
