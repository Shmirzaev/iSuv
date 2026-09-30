import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';

import type { LiveOperationsInspector } from '@isuv/contracts';
import { translate, type Locale, type TranslationKey } from '@isuv/i18n';

import { presentationTimeZone } from './format.js';

type TrendPoint = LiveOperationsInspector['trend'][number];
type TrendKind = TrendPoint['kind'];

// Reserve a deliberate right gutter for the cutoff annotation. The plot's now
// line remains the data cutoff, while the label has room to stay inside the SVG.
const chart = { width: 1200, left: 160, right: 1120, top: 18, bottom: 408 };
const kinds: readonly TrendKind[] = ['stage', 'discharge', 'accumulated_volume'];
const units = { stage: 'm', discharge: 'm³/s', accumulated_volume: 'm³' } as const;
const labels: Record<TrendKind, TranslationKey> = {
  stage: 'stage',
  discharge: 'discharge',
  accumulated_volume: 'volume',
};
const hourMs = 60 * 60 * 1000;
const minorMs = 10 * 60 * 1000;

export function trendWindow(referenceAt: string): { start: number; end: number } {
  const end = new Date(referenceAt).getTime();
  return { start: end - 24 * hourMs, end };
}

export function trendPointX(at: string, referenceAt: string): number {
  const window = trendWindow(referenceAt);
  const fraction = Math.max(
    0,
    Math.min(1, (new Date(at).getTime() - window.start) / (window.end - window.start)),
  );
  return chart.left + fraction * (chart.right - chart.left);
}

export function localUtcOffset(at: string): string {
  const part = new Intl.DateTimeFormat('en', {
    timeZone: presentationTimeZone,
    timeZoneName: 'longOffset',
  })
    .formatToParts(new Date(at))
    .find((item) => item.type === 'timeZoneName')?.value;
  return (part ?? 'UTC').replace('GMT', 'UTC');
}

function localTime(locale: Locale, at: number): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: presentationTimeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(at));
}

function numeric(value: string | null): number | null {
  const result = value === null ? Number.NaN : Number(value);
  return Number.isFinite(result) ? result : null;
}

function series(
  points: TrendPoint[],
  kind: TrendKind,
  window: { start: number; end: number },
): TrendPoint[] {
  return points
    .filter(
      (point) =>
        point.kind === kind &&
        new Date(point.at).getTime() >= window.start &&
        new Date(point.at).getTime() <= window.end,
    )
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

function geometry(points: TrendPoint[], kind: TrendKind, layout = chart) {
  const index = kinds.indexOf(kind);
  const band = (layout.bottom - layout.top) / kinds.length;
  const bandTop = layout.top + index * band;
  const top = bandTop + 26;
  const bottom = layout.top + (index + 1) * band - 5;
  // Reserve a footer for gap labels, clear of traces, points and correction ticks.
  const plotBottom = bottom - 25;
  const reported = points
    .filter((point) => !point.gap)
    .map((point) => ({ point, value: numeric(point.validated ?? point.raw) }))
    .filter((entry): entry is { point: TrendPoint; value: number } => entry.value !== null);
  const values = reported.flatMap((entry) => {
    const raw = numeric(entry.point.raw);
    return raw === null ? [entry.value] : [entry.value, raw];
  });
  const low = values.length ? Math.min(...values) : 0;
  const high = values.length ? Math.max(...values) : 1;
  const padding = low === high ? Math.max(Math.abs(low) * 0.05, 1) : (high - low) * 0.08;
  const min = low - padding;
  const max = high + padding;
  return {
    top,
    bandTop,
    bottom,
    plotBottom,
    min,
    max,
    reported,
    y: (value: number) => plotBottom - ((value - min) / (max - min || 1)) * (plotBottom - top),
  };
}

function cadence(points: { point: TrendPoint }[]): number | null {
  const intervals = points
    .slice(1)
    .map(
      (entry, index) =>
        new Date(entry.point.at).getTime() - new Date(points[index]!.point.at).getTime(),
    )
    .filter((interval) => interval > 0)
    .sort((a, b) => a - b);
  return intervals.length ? intervals[Math.floor(intervals.length / 2)]! : null;
}

function formattedValue(locale: Locale, value: number, unit: string): string {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)} ${unit}`;
}

type HatchBand = { start: number; end: number };

function mergeBands(bands: HatchBand[]): HatchBand[] {
  return bands
    .filter((band) => band.end > band.start)
    .sort((a, b) => a.start - b.start)
    .reduce<HatchBand[]>((merged, band) => {
      const last = merged[merged.length - 1];
      if (last && band.start <= last.end) last.end = Math.max(last.end, band.end);
      else merged.push({ ...band });
      return merged;
    }, []);
}

export function missingIntervals(
  points: TrendPoint[],
  reported: { point: TrendPoint }[],
  window: { start: number; end: number },
  _expectedCadence: number | null,
): HatchBand[] {
  if (!points.length) return [];
  if (!reported.length) return [{ start: window.start, end: window.end }];
  const reportTimes = reported.map(({ point }) => new Date(point.at).getTime());
  const missingTimes = points
    .filter(
      (point) => point.gap || (numeric(point.raw) === null && numeric(point.validated) === null),
    )
    .map((point) => new Date(point.at).getTime());
  const bands: HatchBand[] = missingTimes.map((time) => ({
    start: reportTimes.filter((at) => at < time).at(-1) ?? window.start,
    end: reportTimes.find((at) => at > time) ?? window.end,
  }));
  // Sampling density is not proof of an outage. Only supplied missing records
  // establish a hatch; a sparse trace may still be disconnected without one.
  return mergeBands(bands);
}

export function LiveTrendChart({
  locale,
  referenceAt,
  trend,
  ariaLabel,
  dataCondition,
  current,
}: {
  locale: Locale;
  referenceAt: string;
  trend: TrendPoint[];
  ariaLabel: string;
  dataCondition?: LiveOperationsInspector['current']['health']['dataCondition'];
  current?: LiveOperationsInspector['current']['quantities'];
}) {
  const hatchId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(chart.width);
  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setAvailableWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const window = trendWindow(referenceAt);
  const offset = localUtcOffset(referenceAt);
  const nowLabel = translate(locale, 'liveTrendNow');
  const firstTick = Math.ceil(window.start / minorMs) * minorMs;
  const ticks = Array.from(
    { length: Math.floor((window.end - firstTick) / minorMs) + 1 },
    (_, index) => firstTick + index * minorMs,
  );
  const labelStep = availableWidth < 560 ? 4 : availableWidth < 800 ? 2 : 1;
  const layout = {
    width: Math.max(240, Math.floor(availableWidth)),
    left: Math.min(chart.left, Math.max(88, availableWidth * 0.28)),
    right: Math.max(216, Math.floor(availableWidth) - 24),
    top: chart.top,
    bottom: chart.bottom,
  };
  const xAt = (at: string) => {
    const fraction = Math.max(
      0,
      Math.min(1, (new Date(at).getTime() - window.start) / (window.end - window.start)),
    );
    return layout.left + fraction * (layout.right - layout.left);
  };
  const typeSize = 12;
  const noHistory = kinds.filter((kind) => !trend.some((point) => point.kind === kind));
  const accessibleCutoff = `${ariaLabel}; ${nowLabel}: ${localTime(locale, window.end)} ${offset}; ${referenceAt}${noHistory
    .map((kind) => {
      const quantity = current?.[kind === 'accumulated_volume' ? 'accumulatedCounter' : kind];
      return `; ${translate(locale, labels[kind])}: ${translate(locale, 'liveTrendHistoryNotSupplied')}${quantity?.value != null ? `; ${translate(locale, 'liveTrendCurrentSnapshot')}: ${quantity.value} ${units[kind]}; ${translate(locale, 'liveTrendAt')}: ${quantity.observedAt ?? translate(locale, 'notAvailable')}` : ''}`;
    })
    .join('')}`;

  return (
    <div
      ref={containerRef}
      className="live-trend-strip"
      role="img"
      aria-label={accessibleCutoff}
      tabIndex={0}
    >
      <svg
        viewBox={`0 0 ${layout.width} 460`}
        preserveAspectRatio="none"
        aria-hidden="true"
        style={{ '--live-trend-type': `${typeSize}px` } as CSSProperties}
      >
        <defs>
          <pattern
            id={hatchId}
            width="7"
            height="7"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="7" className="live-trend-strip__hatch-line" />
          </pattern>
        </defs>
        <rect
          className="live-trend-strip__paper"
          x={layout.left}
          y={layout.top}
          width={layout.right - layout.left}
          height={layout.bottom - layout.top}
        />
        {ticks.map((tick) => {
          const major = tick % hourMs === 0;
          const label = major && Math.floor(tick / hourMs) % labelStep === 0;
          const x = xAt(new Date(tick).toISOString());
          return (
            <g key={tick}>
              <line
                x1={x}
                y1={layout.top}
                x2={x}
                y2={layout.bottom}
                className={major ? 'live-trend-strip__grid-major' : 'live-trend-strip__grid-minor'}
              />
              {label ? (
                <text x={x} y="434" className="live-trend-strip__tick" textAnchor="middle">
                  {localTime(locale, tick)}
                </text>
              ) : null}
            </g>
          );
        })}
        {kinds.map((kind) => {
          const points = series(trend, kind, window);
          const track = geometry(points, kind);
          const historySupplied = !noHistory.includes(kind);
          const quantity = current?.[kind === 'accumulated_volume' ? 'accumulatedCounter' : kind];
          const currentValue = quantity ? numeric(quantity.value) : null;
          const expectedCadence = cadence(track.reported);
          const hatches = missingIntervals(points, track.reported, window, expectedCadence);
          const gapLabel = translate(locale, 'noData');
          // One em per character is a conservative bound for the local UI fonts.
          const gapLabelWidth = gapLabel.length * typeSize + 12;
          const gapLabelPlate = (center: number) => (
            <g>
              <rect
                className="live-trend-strip__no-data-plate"
                x={center - gapLabelWidth / 2}
                y={track.bottom - 17}
                width={gapLabelWidth}
                height={18}
              />
              <text
                x={center}
                y={track.bottom - 4}
                className="live-trend-strip__no-data"
                textAnchor="middle"
              >
                {gapLabel}
              </text>
            </g>
          );
          const path = track.reported
            .reduce<string[]>((segments, entry, index, entries) => {
              const prior = entries[index - 1];
              const priorAt = prior ? new Date(prior.point.at).getTime() : null;
              const currentAt = new Date(entry.point.at).getTime();
              const crossesHatch =
                priorAt !== null &&
                hatches.some((band) => band.start < currentAt && band.end > priorAt);
              const joined =
                prior &&
                expectedCadence !== null &&
                currentAt - priorAt! <= expectedCadence * 1.5 &&
                !crossesHatch;
              segments.push(`${joined ? 'L' : 'M'} ${xAt(entry.point.at)} ${track.y(entry.value)}`);
              return segments;
            }, [])
            .join(' ');
          return (
            <g key={kind} data-measurement={kind} data-history-supplied={historySupplied}>
              {!historySupplied ? (
                <rect
                  x="0"
                  y={track.bandTop}
                  width={layout.width}
                  height="130"
                  className="live-trend-strip__paper"
                />
              ) : null}
              <line
                x1={layout.left}
                y1={track.bottom + 5}
                x2={layout.right}
                y2={track.bottom + 5}
                className="live-trend-strip__track-rule"
              />
              {(historySupplied ? [0.25, 0.5, 0.75] : []).map((fraction) => (
                <line
                  key={fraction}
                  x1={layout.left}
                  y1={track.top + (track.plotBottom - track.top) * fraction}
                  x2={layout.right}
                  y2={track.top + (track.plotBottom - track.top) * fraction}
                  className="live-trend-strip__grid-minor"
                />
              ))}
              <rect
                x="0"
                y={track.bandTop}
                width={layout.width}
                height="22"
                className="live-trend-strip__paper"
              />
              <text x="4" y={track.bandTop + 15} className="live-trend-strip__unit">
                {translate(locale, labels[kind])} ({units[kind]})
              </text>
              {!historySupplied ? (
                <>
                  <foreignObject x="4" y={track.top + 4} width={layout.width - 8} height="48">
                    <p className="live-trend-strip__history-note">
                      {translate(locale, 'liveTrendHistoryNotSupplied')}
                    </p>
                  </foreignObject>
                  {currentValue !== null && quantity ? (
                    <g
                      className={
                        quantity.dataState === 'unreliable' || dataCondition === 'unreliable'
                          ? 'live-trend-strip__current--unreliable'
                          : undefined
                      }
                    >
                      <title>{`${quantity.value} ${units[kind]}; ${quantity.observedAt ?? translate(locale, 'notAvailable')}`}</title>
                      <line
                        x1={layout.right - 8}
                        x2={layout.right}
                        y1={track.plotBottom}
                        y2={track.plotBottom}
                        className="live-trend-strip__current-tick"
                      />
                      <text
                        x={layout.right - 12}
                        y={track.plotBottom + 4}
                        textAnchor="end"
                        className="live-trend-strip__value"
                      >
                        {formattedValue(locale, currentValue, units[kind])}
                      </text>
                      <text x="4" y={track.bottom - 3} className="live-trend-strip__snapshot-label">
                        {translate(locale, 'liveTrendCurrentSnapshot')}:{' '}
                        {quantity.observedAt
                          ? `${localTime(locale, new Date(quantity.observedAt).getTime())} ${localUtcOffset(quantity.observedAt)}`
                          : translate(locale, 'notAvailable')}
                      </text>
                    </g>
                  ) : null}
                </>
              ) : null}
              {track.reported.length ? (
                <>
                  <text
                    x={layout.left - 8}
                    y={track.top + 4}
                    className="live-trend-strip__value"
                    textAnchor="end"
                  >
                    {formattedValue(locale, track.max, units[kind])}
                  </text>
                  <text
                    x={layout.left - 8}
                    y={track.plotBottom}
                    className="live-trend-strip__value"
                    textAnchor="end"
                  >
                    {formattedValue(locale, track.min, units[kind])}
                  </text>
                </>
              ) : null}
              {hatches.map((band) => {
                const start = xAt(new Date(band.start).toISOString());
                const end = xAt(new Date(band.end).toISOString());
                const midpoint = (start + end) / 2;
                const labelCenter = Math.max(
                  gapLabelWidth / 2 + 4,
                  Math.min(layout.width - gapLabelWidth / 2 - 4, midpoint),
                );
                const bracketY = track.plotBottom + 5;
                return (
                  <g key={`${band.start}-${band.end}`}>
                    <rect
                      x={start}
                      y={track.top}
                      width={end - start}
                      height={track.bottom - track.top}
                      fill={`url(#${hatchId})`}
                      className="live-trend-strip__gap"
                    />
                    <path
                      className="live-trend-strip__gap-bracket"
                      d={`M ${start} ${bracketY - 2} V ${bracketY} H ${end} V ${bracketY - 2}`}
                    />
                    <line
                      className="live-trend-strip__gap-leader"
                      x1={midpoint}
                      y1={bracketY}
                      x2={labelCenter}
                      y2={track.bottom - 17}
                    />
                    {gapLabelPlate(labelCenter)}
                  </g>
                );
              })}
              {path ? <path d={path} className="live-trend-strip__trace" /> : null}
              {dataCondition === 'stale' ? (
                <>
                  <text
                    x={layout.right - 6}
                    y={track.top + 14}
                    className="live-trend-strip__state-tag"
                    textAnchor="end"
                  >
                    {translate(locale, 'liveDataStale')}
                  </text>
                </>
              ) : null}
              {track.reported.map(({ point, value }) => (
                <g key={point.at}>
                  <circle
                    cx={xAt(point.at)}
                    cy={track.y(value)}
                    r="2.6"
                    className="live-trend-strip__point"
                  />
                  {point.raw !== null &&
                  point.validated !== null &&
                  point.raw !== point.validated ? (
                    <line
                      x1={xAt(point.at) - 3}
                      y1={track.y(Number(point.raw)) - 3}
                      x2={xAt(point.at) + 3}
                      y2={track.y(Number(point.raw)) + 3}
                      className="live-trend-strip__original-tick"
                    />
                  ) : null}
                </g>
              ))}
            </g>
          );
        })}
        <line
          x1={layout.right}
          y1={layout.top - 4}
          x2={layout.right}
          y2={layout.bottom + 7}
          className="live-trend-strip__now"
        />
        <text x={layout.right} y="451" className="live-trend-strip__now-label" textAnchor="end">
          {nowLabel} / {offset}
        </text>
      </svg>
    </div>
  );
}
