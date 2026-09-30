import { strict as assert } from 'node:assert';
import test from 'node:test';

import { renderToStaticMarkup } from 'react-dom/server';
import type { LiveOperationsInspector } from '@isuv/contracts';
import { translate } from '@isuv/i18n';

import {
  LiveTrendChart,
  localUtcOffset,
  missingIntervals,
  trendPointX,
  trendWindow,
} from './live-trend-chart.js';

const referenceAt = '2026-08-22T12:00:00.000Z';

test('trend chart anchors its 24-hour chart paper axis at the data cutoff', () => {
  const window = trendWindow(referenceAt);
  assert.equal(new Date(window.start).toISOString(), '2026-08-21T12:00:00.000Z');
  assert.equal(trendPointX('2026-08-21T12:00:00.000Z', referenceAt), 160);
  assert.equal(trendPointX(referenceAt, referenceAt), 1120);
  assert.equal(localUtcOffset(referenceAt), 'UTC+05:00');
});

test('trend chart exposes the local time axis, units, and explicit hatched no-data evidence', () => {
  const trend = [
    {
      at: '2026-08-22T09:00:00.000Z',
      kind: 'stage' as const,
      raw: '1.20',
      validated: '1.22',
      unit: 'm' as const,
      gap: false,
      source: {} as never,
    },
    {
      at: '2026-08-22T10:00:00.000Z',
      kind: 'stage' as const,
      raw: null,
      validated: null,
      unit: 'm' as const,
      gap: true,
      source: {} as never,
    },
  ];
  const markup = renderToStaticMarkup(
    <LiveTrendChart
      locale="en"
      referenceAt={referenceAt}
      trend={trend}
      ariaLabel="Synthetic history"
    />,
  );
  assert.match(
    markup,
    /role="img" aria-label="Synthetic history; Now at data cutoff: 17:00 UTC\+05:00; 2026-08-22T12:00:00.000Z; Discharge:/,
  );
  assert.match(markup, /live-trend-strip__grid-minor/);
  assert.match(markup, /Stage \(m\)/);
  assert.match(markup, /Discharge \(m³\/s\)/);
  assert.match(markup, /Accumulated volume \(m³\)/);
  assert.match(markup, /<pattern id="_R_0_"/);
  assert.match(markup, /No data/);
  assert.match(
    markup,
    /<text x="1176" y="451" class="live-trend-strip__now-label" text-anchor="end">Now at data cutoff \/ UTC\+05:00<\/text>/,
  );
});

test('missing intervals span recorded gaps and prevent a trace from joining across them', () => {
  const points = [
    {
      at: '2026-08-22T08:00:00.000Z',
      kind: 'stage' as const,
      raw: '1',
      validated: '1',
      unit: 'm' as const,
      gap: false,
      source: {} as never,
    },
    {
      at: '2026-08-22T09:00:00.000Z',
      kind: 'stage' as const,
      raw: null,
      validated: null,
      unit: 'm' as const,
      gap: true,
      source: {} as never,
    },
    {
      at: '2026-08-22T10:00:00.000Z',
      kind: 'stage' as const,
      raw: '2',
      validated: '2',
      unit: 'm' as const,
      gap: false,
      source: {} as never,
    },
  ];
  const bands = missingIntervals(
    points,
    [{ point: points[0]! }, { point: points[2]! }],
    {
      start: new Date(points[0]!.at).getTime(),
      end: new Date(points[2]!.at).getTime(),
    },
    60 * 60 * 1000,
  );
  assert.deepEqual(bands, [
    { start: new Date(points[0]!.at).getTime(), end: new Date(points[2]!.at).getTime() },
  ]);
  const markup = renderToStaticMarkup(
    <LiveTrendChart
      locale="en"
      referenceAt={referenceAt}
      trend={points}
      ariaLabel="Synthetic history"
    />,
  );
  assert.match(markup, /d="M [^"]+ M [^"]+"/);
});

test('mid-window gap label bounds stay clear of trace points for wide and narrow gaps', () => {
  for (const gapHours of [[12], [11, 12, 13]]) {
    const trend = Array.from({ length: 25 }, (_, hour) => {
      const gap = gapHours.includes(hour);
      return {
        at: new Date(trendWindow(referenceAt).start + hour * 3_600_000).toISOString(),
        kind: 'stage' as const,
        raw: gap ? null : String(1 + (hour % 5) / 10),
        validated: gap ? null : String(1 + (hour % 5) / 10),
        unit: 'm' as const,
        gap,
        source: {} as never,
      };
    });
    const markup = renderToStaticMarkup(
      <LiveTrendChart
        locale="en"
        referenceAt={referenceAt}
        trend={trend}
        ariaLabel="Gap fixture"
      />,
    );
    const number = (tag: string, name: string) =>
      Number(tag.match(new RegExp(` ${name}="([^"]+)"`))![1]);
    const boxes = [
      ...markup.matchAll(/<rect\b[^>]*class="live-trend-strip__no-data-plate"[^>]*>/g),
    ].map(([tag]) => ({
      x: number(tag, 'x'),
      y: number(tag, 'y'),
      width: number(tag, 'width'),
      height: number(tag, 'height'),
    }));
    const points = [...markup.matchAll(/<circle\b[^>]*class="live-trend-strip__point"[^>]*>/g)].map(
      ([tag]) => ({ x: number(tag, 'cx'), y: number(tag, 'cy'), radius: number(tag, 'r') }),
    );
    assert.equal(boxes.length, 1, 'Only the supplied stage history has a gap label');
    assert.equal(points.length, 25 - gapHours.length);
    for (const box of boxes) {
      for (const point of points) {
        const intersects =
          point.x + point.radius >= box.x &&
          point.x - point.radius <= box.x + box.width &&
          point.y + point.radius >= box.y &&
          point.y - point.radius <= box.y + box.height;
        assert.equal(
          intersects,
          false,
          `Label ${JSON.stringify(box)} intersects point ${JSON.stringify(point)}`,
        );
      }
    }
    const stageLabel = boxes[0]!;
    const hatch = markup.match(/<rect\b[^>]*class="live-trend-strip__gap"[^>]*>/)![0];
    const midpoint = number(hatch, 'x') + number(hatch, 'width') / 2;
    assert.equal(
      stageLabel.x + stageLabel.width / 2,
      midpoint,
      'Label is attached to its gap, including narrow gaps',
    );
    const leader = markup.match(/<line\b[^>]*class="live-trend-strip__gap-leader"[^>]*>/)![0];
    assert.equal(number(leader, 'x1'), midpoint);
    assert.equal(number(leader, 'x2'), midpoint);
    assert.equal(number(leader, 'y2'), stageLabel.y);
    assert.ok(points.every((point) => point.y + point.radius < number(leader, 'y1')));
    assert.match(markup, /class="live-trend-strip__gap-bracket"/);
  }
});

test('omitted histories are plain unavailable history with current ticks, never sensor gaps', () => {
  const current = {
    stage: { value: null, dataState: 'no_data' },
    discharge: { value: '2.10', dataState: 'reported', observedAt: '2026-08-22T10:00:00.000Z' },
    accumulatedCounter: { value: '0', dataState: 'reported', observedAt: referenceAt },
  } as unknown as LiveOperationsInspector['current']['quantities'];
  for (const locale of ['en', 'ru', 'uz'] as const) {
    const markup = renderToStaticMarkup(
      <LiveTrendChart
        locale={locale}
        referenceAt={referenceAt}
        trend={[]}
        current={current}
        ariaLabel="History fixture"
      />,
    );
    assert.equal((markup.match(/data-history-supplied="false"/g) ?? []).length, 3);
    assert.doesNotMatch(markup, /class="live-trend-strip__gap"/);
    assert.doesNotMatch(markup, /class="live-trend-strip__no-data"/);
    assert.equal(
      (markup.match(/class="live-trend-strip__current-tick"/g) ?? []).length,
      2,
      'Zero is a supplied current reading',
    );
    assert.ok(markup.includes(translate(locale, 'liveTrendHistoryNotSupplied')));
    assert.ok(
      markup.includes(
        `${translate(locale, 'liveTrendCurrentSnapshot')}: 2.10 m³/s; ${translate(locale, 'liveTrendAt')}: 2026-08-22T10:00:00.000Z`,
      ),
    );
    assert.match(markup, /viewBox="0 0 1200 460"/);
  }
  assert.deepEqual(missingIntervals([], [], trendWindow(referenceAt), null), []);
});

test('sparse supplied readings do not invent sensor outages from inferred cadence', () => {
  const points = [1, 2, 20].map((hour) => ({
    at: new Date(trendWindow(referenceAt).start + hour * 3_600_000).toISOString(),
    kind: 'stage' as const,
    raw: '1.2',
    validated: '1.2',
    unit: 'm' as const,
    gap: false,
    source: {} as never,
  }));
  assert.deepEqual(
    missingIntervals(
      points,
      points.map((point) => ({ point })),
      trendWindow(referenceAt),
      3_600_000,
    ),
    [],
  );
  const markup = renderToStaticMarkup(
    <LiveTrendChart
      locale="en"
      referenceAt={referenceAt}
      trend={points}
      ariaLabel="Sparse supplied history"
    />,
  );
  assert.doesNotMatch(markup, /class="live-trend-strip__gap"/);
});

test('explicit all-gap history remains hatched while omitted quantities remain plain', () => {
  const trend = [
    {
      at: referenceAt,
      kind: 'stage' as const,
      raw: null,
      validated: null,
      unit: 'm' as const,
      gap: true,
      source: {} as never,
    },
  ];
  const markup = renderToStaticMarkup(
    <LiveTrendChart locale="en" referenceAt={referenceAt} trend={trend} ariaLabel="Gap fixture" />,
  );
  assert.equal((markup.match(/class="live-trend-strip__gap"/g) ?? []).length, 1);
  assert.equal((markup.match(/data-history-supplied="false"/g) ?? []).length, 2);
  assert.equal((markup.match(/class="live-trend-strip__no-data"/g) ?? []).length, 1);
});
