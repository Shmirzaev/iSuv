import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyDashboardDataState,
  dashboardIntervalDurationMicroseconds,
  dashboardWindows,
  exactDashboardDeviation,
} from './model.js';

test('dashboard windows preserve microseconds, Tashkent day boundaries, and exact prior duration', () => {
  const result = dashboardWindows('today', '2026-08-24T07:34:56.123456Z');
  assert.deepEqual(result.selected, {
    start: '2026-08-23T19:00:00.000000Z',
    end: '2026-08-24T07:34:56.123456Z',
  });
  assert.deepEqual(result.prior, {
    start: '2026-08-23T06:25:03.876544Z',
    end: '2026-08-23T19:00:00.000000Z',
  });
  assert.equal(dashboardIntervalDurationMicroseconds(result.selected), '45296123456');
  assert.equal(dashboardIntervalDurationMicroseconds(result.prior), '45296123456');
  assert.throws(
    () =>
      dashboardIntervalDurationMicroseconds({
        start: result.selected.end,
        end: result.selected.start,
      }),
    /positive/,
  );
});

test('dashboard week, month, season, and year use Asia/Tashkent calendar starts', () => {
  const at = '2026-08-24T07:34:56.123456Z';
  assert.equal(dashboardWindows('week', at).selected.start, '2026-08-23T19:00:00.000000Z');
  assert.equal(dashboardWindows('month', at).selected.start, '2026-07-31T19:00:00.000000Z');
  assert.equal(dashboardWindows('season', at).selected.start, '2026-03-31T19:00:00.000000Z');
  assert.equal(dashboardWindows('year', at).selected.start, '2025-12-31T19:00:00.000000Z');
});

test('dashboard status never treats no data or unreliable evidence as assessable normal data', () => {
  assert.equal(classifyDashboardDataState('reported'), 'assessable');
  assert.equal(classifyDashboardDataState('no_data'), 'no_data');
  assert.equal(classifyDashboardDataState('unreliable'), 'unreliable');
  assert.equal(classifyDashboardDataState('unconfigured'), 'unconfigured');
  assert.deepEqual(exactDashboardDeviation('10.25', '8'), {
    signed: { numerator: -9n, denominator: 4n },
    absolute: { numerator: 9n, denominator: 4n },
  });
});
