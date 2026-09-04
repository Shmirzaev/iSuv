import { strict as assert } from 'node:assert';
import test from 'node:test';

import { renderToStaticMarkup } from 'react-dom/server';

import { GroupedBarChart, SignedBarChart, StackedBarChart, type ChartDatum } from './charts.js';

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
  assert.match(markup, /class="ops-chart__canvas"/);
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
    <StackedBarChart ariaLabel="Quality summary" caption="Quality coverage" data={data} />,
  );
  assert.match(signed, /ops-chart__bar--negative/);
  assert.match(signed, /-20 m³/);
  assert.match(stacked, /ops-chart--stacked/);
  assert.match(stacked, /Quality coverage/);
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
  assert.match(markup, /ops-chart__bar--empty/);
  assert.match(markup, /<text class="ops-chart__value"[^>]*>—<\/text>/);
  assert.match(markup, /<text class="ops-chart__axis-label"[^>]*>m³<\/text>/);
});
