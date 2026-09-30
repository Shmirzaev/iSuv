import { strict as assert } from 'node:assert';
import test from 'node:test';

import { renderToStaticMarkup } from 'react-dom/server';

import {
  DashboardPlanActualChart,
  GroupedBarChart,
  SignedBarChart,
  StackedBarChart,
  type ChartDatum,
  rationalChartValue,
} from './charts.js';

const data: readonly ChartDatum[] = [
  {
    id: 'section-a',
    label: 'Section A',
    series: [
      { id: 'planned', label: 'Planned', value: 100, valueText: '100 m³' },
      { id: 'actual', label: 'Actual', value: 120, valueText: '120 m³' },
    ],
  },
];

test('inline charts keep a labelled SVG and exact table fallback', () => {
  const markup = renderToStaticMarkup(
    <GroupedBarChart ariaLabel="Planned and actual summary" caption="Delivery chart" data={data} />,
  );
  assert.match(markup, /<figure aria-label="Planned and actual summary"/);
  assert.match(markup, /<svg aria-hidden="true"/);
  assert.match(markup, /<table class="visually-hidden">/);
  assert.match(markup, /class="analytics-plot__canvas"/);
  assert.match(markup, /analytics-plot__grid-minor/);
  assert.match(markup, /analytics-plot__bar--reference/);
  assert.match(markup, /analytics-plot__bar--actual/);
  assert.match(markup, /width="100%"/);
  assert.match(markup, /120 m³/);
});

test('signed and stacked charts preserve their accessible exact-value fallbacks', () => {
  const signed = renderToStaticMarkup(
    <SignedBarChart
      ariaLabel="Signed variance summary"
      caption="Signed variance"
      data={[
        {
          ...data[0]!,
          series: [{ id: 'variance', label: 'Variance', value: -20, valueText: '-20 m³' }],
        },
      ]}
    />,
  );
  const stacked = renderToStaticMarkup(
    <StackedBarChart
      ariaLabel="Quality summary"
      caption="Quality coverage"
      axisUnit="Count"
      data={data}
    />,
  );
  assert.match(signed, /analytics-plot--variance/);
  assert.match(signed, /analytics-plot__zero/);
  assert.match(signed, /-20 m³/);
  assert.match(stacked, /analytics-plot--coverage/);
  assert.match(stacked, /Quality coverage/);
  assert.match(stacked, /<text class="analytics-plot__axis-label"[^>]*>Count<\/text>/);
});

test('charts keep long labels out of bars and show null values as unavailable', () => {
  const markup = renderToStaticMarkup(
    <SignedBarChart
      ariaLabel="Variance summary"
      axisUnit="m³"
      caption="Signed variance"
      data={[
        {
          id: 'unavailable',
          label: 'Synthetic section with a deliberately long operational label',
          series: [{ id: 'variance', label: 'Variance', value: null, valueText: '—' }],
        },
      ]}
    />,
  );
  assert.match(
    markup,
    /<title>Synthetic section with a deliberately long operational label<\/title>/,
  );
  assert.match(markup, /Synthetic section with a …/);
  assert.match(markup, /analytics-plot__bar--missing/);
  assert.match(markup, /fill="url\(#/);
  assert.match(markup, /<text class="analytics-plot__value"[^>]*>—<\/text>/);
  assert.match(markup, /<text class="analytics-plot__axis-label"[^>]*>m³<\/text>/);
});

test('dashboard strip chart only draws supplied aggregate intervals and keeps the exact table', () => {
  const markup = renderToStaticMarkup(
    <DashboardPlanActualChart
      ariaLabel="Actual and plan by reporting interval"
      caption="Delivery intervals"
      data={[
        {
          id: 'prior',
          label: 'Prior interval',
          start: '2026-09-27T19:00:00.000Z',
          end: '2026-09-28T19:00:00.000Z',
          actual: 84,
          actualText: '84 mÂ³',
          planned: null,
          plannedText: 'Not available',
        },
        {
          id: 'selected',
          label: 'Selected interval',
          start: '2026-09-28T19:00:00.000Z',
          end: '2026-09-29T19:00:00.000Z',
          actual: null,
          actualText: 'Not available',
          planned: null,
          plannedText: 'Not available',
        },
      ]}
      locale="en"
      unitLabel="mÂ³"
      actualLabel="Actual"
      aggregateNote="Aggregate totals for each reporting interval"
      intervalLabel="Interval"
      planLabel="Plan / reference"
    />,
  );
  assert.match(
    markup,
    /<figure aria-label="Actual and plan by reporting interval" class="dashboard-strip-chart" tabindex="0">/,
  );
  assert.match(markup, /Asia\/Tashkent UTC\+05:00/);
  assert.match(markup, /dashboard-strip-chart__actual/);
  assert.match(markup, /dashboard-strip-chart__gap/);
  assert.match(markup, /Plan \/ reference: Not available/);
  assert.match(markup, /Aggregate totals for each reporting interval/);
  assert.match(markup, /Selected interval/);
  assert.match(markup, /2026-09-27T19:00:00.000Z — 2026-09-28T19:00:00.000Z/);
  assert.match(markup, /<table class="visually-hidden">/);
  assert.match(markup, /Prior interval/);
});

test('dashboard chart values retain bounded exact-rational geometry and omit unplottable values', () => {
  const numerator = `9${'0'.repeat(300)}`;
  const denominator = `3${'0'.repeat(299)}`;
  assert.equal(rationalChartValue({ numerator, denominator }), 30);
  assert.equal(rationalChartValue({ numerator: '0', denominator: '7' }), 0);
  assert.equal(rationalChartValue({ numerator: `1${'0'.repeat(400)}`, denominator: '1' }), null);

  const markup = renderToStaticMarkup(
    <DashboardPlanActualChart
      actualLabel="Actual"
      aggregateNote="Aggregate totals for each reporting interval"
      ariaLabel="Finite geometry only"
      caption="Finite geometry"
      data={[
        {
          id: 'invalid',
          label: 'Selected interval',
          start: '2026-09-28T19:00:00.000Z',
          end: '2026-09-29T19:00:00.000Z',
          actual: Number.POSITIVE_INFINITY,
          actualText: 'exact raw value',
          planned: -5,
          plannedText: '-5 mÂ³',
        },
      ]}
      intervalLabel="Interval"
      locale="en"
      planLabel="Plan"
      unitLabel="mÂ³"
    />,
  );
  assert.doesNotMatch(markup, /(?:NaN|Infinity)/);
  assert.match(markup, /dashboard-strip-chart__gap/);
  assert.match(markup, /dashboard-strip-chart__plan/);
});
