import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import type { Locale } from '@isuv/i18n';

import { presentationTimeZone } from './format.js';

export interface ChartSeries {
  id: string;
  label: string;
  value: number | null;
  valueText: ReactNode;
}

export interface ChartDatum {
  id: string;
  label: string;
  series: readonly ChartSeries[];
}

/**
 * An aggregate measurement over a real, bounded time interval.  The dashboard
 * API supplies selected and prior aggregates, rather than a sampled series;
 * keeping their start and end is what prevents this chart from inventing a
 * continuous hourly history.
 */
export interface DashboardIntervalDatum {
  id: string;
  label: string;
  start: string;
  end: string;
  actual: number | null;
  actualText: ReactNode;
  planned: number | null;
  plannedText: ReactNode;
}

/**
 * Converts an exact rational to a bounded plotting value without first turning
 * its numerator and denominator into `Infinity`. The visible table continues
 * to carry the original exact evidence; this value is visual geometry only.
 */
export function rationalChartValue(
  value: {
    numerator: string;
    denominator: string;
  } | null,
): number | null {
  if (value === null) return null;
  try {
    const numerator = BigInt(value.numerator);
    const denominator = BigInt(value.denominator);
    if (denominator === 0n) return null;
    if (numerator === 0n) return 0;

    const sign = numerator < 0n !== denominator < 0n ? -1 : 1;
    const numeratorDigits = (numerator < 0n ? -numerator : numerator).toString();
    const denominatorDigits = (denominator < 0n ? -denominator : denominator).toString();
    const precision = 16;
    const coefficient = (digits: string) => {
      const head = digits.slice(0, precision);
      return Number(head) / 10 ** (head.length - 1);
    };
    const exponent = numeratorDigits.length - denominatorDigits.length;
    // Number can represent normal and subnormal finite values only within
    // this exponent range. Underflowing a nonzero value to zero would lie.
    if (exponent > 308 || exponent < -323) return null;
    const result =
      sign * (coefficient(numeratorDigits) / coefficient(denominatorDigits)) * 10 ** exponent;
    return Number.isFinite(result) && result !== 0 ? result : null;
  } catch {
    return null;
  }
}

function chartValues(data: readonly ChartDatum[]): number[] {
  return data.flatMap((datum) =>
    datum.series.flatMap((series) =>
      series.value !== null && Number.isFinite(series.value) ? [Math.abs(series.value)] : [],
    ),
  );
}

function FallbackTable({ caption, data }: { caption: string; data: readonly ChartDatum[] }) {
  const headers = data[0]?.series ?? [];
  return (
    <table className="visually-hidden">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{caption}</th>
          {headers.map((series) => (
            <th key={series.id} scope="col">
              {series.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((datum) => (
          <tr key={datum.id}>
            <th scope="row">{datum.label}</th>
            {datum.series.map((series) => (
              <td key={series.id}>{series.valueText}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const chartWidth = 800;
const labelWidth = 224;
const chartRight = chartWidth - 24;

function useEffectiveChartFont(designWidth: number) {
  const canvasRef = useRef<SVGSVGElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(designWidth);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const measure = () => setCanvasWidth(canvas.getBoundingClientRect().width || designWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [designWidth]);
  return { canvasRef, fontSize: `${(12 * designWidth) / canvasWidth}px` };
}

function compactAxisValue(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1);
}

function truncateLabel(label: string, maximum = 26): string {
  return label.length > maximum ? `${label.slice(0, Math.max(1, maximum - 1))}…` : label;
}

function ChartLabel({ label, x, y }: { label: string; x: number; y: number }) {
  return (
    <text className="analytics-plot__label" x={x} y={y}>
      <title>{label}</title>
      {truncateLabel(label)}
    </text>
  );
}

function ValueAxis({
  max,
  start,
  end,
  y,
  negative = false,
  unitLabel,
  gridBottom,
}: {
  max: number;
  start: number;
  end: number;
  y: number;
  negative?: boolean;
  unitLabel?: string | undefined;
  gridBottom?: number | undefined;
}) {
  // These are measurement ticks, rather than a decorative background.  The
  // analytics API returns category aggregates, so a temporal axis here would
  // invent a history that does not exist.
  const ticks = Array.from({ length: 11 }, (_, index) => index / 10);
  return (
    <g className="analytics-plot__axis">
      <line className="analytics-plot__axis-rule" x1={start} x2={end} y1={y} y2={y} />
      {ticks.map((ratio) => {
        const x = start + (end - start) * ratio;
        const value = negative ? -max + max * ratio : max * ratio;
        return (
          <g key={ratio}>
            <line
              className={
                ratio % 0.5 === 0 ? 'analytics-plot__grid-major' : 'analytics-plot__grid-minor'
              }
              x1={x}
              x2={x}
              y1={y}
              y2={gridBottom ?? y + 4}
            />
            {ratio % 0.5 === 0 ? (
              <text className="analytics-plot__axis-label" textAnchor="middle" x={x} y={y - 8}>
                {compactAxisValue(value)}
              </text>
            ) : null}
          </g>
        );
      })}
      {unitLabel ? (
        <text className="analytics-plot__axis-label" textAnchor="end" x={end} y={y - 22}>
          {unitLabel}
        </text>
      ) : null}
    </g>
  );
}

/**
 * Aggregate categories are plotted on a measured numeric grid. The API does
 * not supply a series for them, so this deliberately does not invent a time
 * trace. The adjacent table remains the exact accessible record.
 */
export function GroupedBarChart({
  ariaLabel,
  caption,
  data,
  axisUnit,
  unavailableLabel = '—',
}: {
  ariaLabel: string;
  caption: string;
  data: readonly ChartDatum[];
  axisUnit?: string | undefined;
  unavailableLabel?: string | undefined;
}) {
  const hatchId = useId();
  const { canvasRef, fontSize } = useEffectiveChartFont(chartWidth);
  const values = chartValues(data);
  const max = Math.max(...values, 1);
  const height = Math.max(240, data.length * 68 + 56);
  const plotWidth = chartRight - labelWidth - 76;
  const seriesCount = Math.max(data[0]?.series.length ?? 1, 1);
  const legend = data[0]?.series ?? [];
  return (
    <figure
      aria-label={ariaLabel}
      className="analytics-plot analytics-plot--comparison"
      tabIndex={0}
    >
      <svg
        aria-hidden="true"
        className="analytics-plot__canvas"
        ref={canvasRef}
        role="img"
        style={{ fontSize }}
        viewBox={`0 0 ${chartWidth} ${height}`}
        width="100%"
      >
        <defs>
          <pattern
            id={hatchId}
            width="7"
            height="7"
            patternTransform="rotate(45)"
            patternUnits="userSpaceOnUse"
          >
            <line className="analytics-plot__hatch-line" x1="0" x2="0" y1="0" y2="7" />
          </pattern>
        </defs>
        <ValueAxis
          end={labelWidth + plotWidth}
          max={max}
          start={labelWidth}
          unitLabel={axisUnit}
          y={34}
          gridBottom={height - 12}
        />
        {data.map((datum, index) => {
          const y = 50 + index * 68;
          return (
            <g key={datum.id}>
              <ChartLabel label={datum.label} x={8} y={y + 20} />
              <line
                className="analytics-plot__row-rule"
                x1={labelWidth}
                x2={labelWidth + plotWidth}
                y1={y + 10}
                y2={y + 10}
              />
              {datum.series.map((series, seriesIndex) => {
                const value =
                  series.value !== null && Number.isFinite(series.value) ? series.value : null;
                const ratio = value === null ? 0 : Math.abs(value) / max;
                const barHeight = 20;
                const barY = y + seriesIndex * 28;
                const barWidth = Math.max(0, ratio * plotWidth);
                const visibleWidth = value === null ? plotWidth : barWidth;
                const valueX =
                  value === null
                    ? labelWidth + plotWidth / 2
                    : Math.min(labelWidth + visibleWidth + 8, chartRight - 16);
                const valueLabel = value === null ? unavailableLabel : compactAxisValue(value);
                return (
                  <g key={series.id}>
                    <rect
                      className={`analytics-plot__bar ${series.id === 'planned' || series.id === 'reference' ? 'analytics-plot__bar--reference' : 'analytics-plot__bar--actual'} ${value === null ? 'analytics-plot__bar--missing' : ''}`}
                      fill={value === null ? `url(#${hatchId})` : undefined}
                      height={barHeight}
                      width={visibleWidth}
                      x={labelWidth}
                      y={barY}
                    >
                      <title>{`${series.label}: ${valueLabel}`}</title>
                    </rect>
                    <text
                      className="analytics-plot__value"
                      textAnchor={value === null ? 'middle' : undefined}
                      x={valueX}
                      y={barY + 15}
                    >
                      {valueLabel}
                    </text>
                  </g>
                );
              })}
              {seriesCount > 1 ? null : (
                <line
                  className="analytics-plot__row-rule"
                  x1={labelWidth}
                  x2={labelWidth + plotWidth}
                  y1={y + 10}
                  y2={y + 10}
                />
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="analytics-plot__legend">
        {legend.map((series, index) => (
          <span key={series.id}>
            <i
              aria-hidden="true"
              className={`analytics-plot__swatch ${series.id === 'planned' || series.id === 'reference' ? 'analytics-plot__swatch--reference' : 'analytics-plot__swatch--actual'}`}
            />
            {series.label}
          </span>
        ))}
      </figcaption>
      <FallbackTable caption={caption} data={data} />
    </figure>
  );
}

export function SignedBarChart({
  ariaLabel,
  caption,
  data,
  axisUnit,
  unavailableLabel = '—',
}: {
  ariaLabel: string;
  caption: string;
  data: readonly ChartDatum[];
  axisUnit?: string | undefined;
  unavailableLabel?: string | undefined;
}) {
  const hatchId = useId();
  const { canvasRef, fontSize } = useEffectiveChartFont(chartWidth);
  const values = chartValues(data);
  const max = Math.max(...values, 1);
  const height = Math.max(240, data.length * 52 + 56);
  const midpoint = 510;
  const plotWidth = 240;
  return (
    <figure aria-label={ariaLabel} className="analytics-plot analytics-plot--variance" tabIndex={0}>
      <svg
        aria-hidden="true"
        className="analytics-plot__canvas"
        ref={canvasRef}
        role="img"
        style={{ fontSize }}
        viewBox={`0 0 ${chartWidth} ${height}`}
        width="100%"
      >
        <defs>
          <pattern
            id={hatchId}
            width="7"
            height="7"
            patternTransform="rotate(45)"
            patternUnits="userSpaceOnUse"
          >
            <line className="analytics-plot__hatch-line" x1="0" x2="0" y1="0" y2="7" />
          </pattern>
        </defs>
        <line
          className="analytics-plot__zero"
          x1={midpoint}
          x2={midpoint}
          y1="38"
          y2={height - 12}
        />
        <ValueAxis
          end={midpoint}
          max={max}
          negative
          start={midpoint - plotWidth}
          unitLabel={axisUnit}
          y={34}
          gridBottom={height - 12}
        />
        <ValueAxis
          end={midpoint + plotWidth}
          max={max}
          start={midpoint}
          y={34}
          gridBottom={height - 12}
        />
        {data.map((datum, index) => {
          const candidate = datum.series[0]?.value ?? null;
          const value = candidate !== null && Number.isFinite(candidate) ? candidate : null;
          const y = 54 + index * 52;
          const magnitude = value === null ? 0 : (Math.abs(value) / max) * plotWidth;
          const visibleWidth = value === null ? plotWidth : magnitude;
          const x =
            value === null
              ? midpoint - plotWidth / 2
              : value >= 0
                ? midpoint
                : midpoint - magnitude;
          const valueLabel = value === null ? unavailableLabel : compactAxisValue(value);
          return (
            <g key={datum.id}>
              <ChartLabel label={datum.label} x={8} y={y + 16} />
              <line
                className="analytics-plot__row-rule"
                x1={midpoint - plotWidth}
                x2={midpoint + plotWidth}
                y1={y + 10}
                y2={y + 10}
              />
              <rect
                className={`analytics-plot__bar ${value === null ? 'analytics-plot__bar--missing' : 'analytics-plot__bar--actual'}`}
                fill={value === null ? `url(#${hatchId})` : undefined}
                height="20"
                width={visibleWidth}
                x={x}
                y={y}
              >
                <title>{valueLabel}</title>
              </rect>
              <text
                className="analytics-plot__value"
                textAnchor="end"
                x={
                  value === null
                    ? midpoint
                    : value < 0
                      ? Math.max(x - 8, midpoint - plotWidth)
                      : midpoint + plotWidth - 8
                }
                y={y + 15}
              >
                {valueLabel}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="analytics-plot__legend">
        {data[0]?.series.map((series, index) => (
          <span key={series.id}>
            <i
              aria-hidden="true"
              className="analytics-plot__swatch analytics-plot__swatch--actual"
            />
            {series.label}
          </span>
        ))}
      </figcaption>
      <FallbackTable caption={caption} data={data} />
    </figure>
  );
}

export function StackedBarChart({
  ariaLabel,
  caption,
  data,
  axisUnit,
}: {
  ariaLabel: string;
  caption: string;
  data: readonly ChartDatum[];
  axisUnit?: string | undefined;
}) {
  const hatchId = useId();
  const { canvasRef, fontSize } = useEffectiveChartFont(800);
  const datum = data[0];
  const total =
    datum?.series.reduce(
      (sum, series) =>
        sum +
        (series.value !== null && Number.isFinite(series.value) ? Math.max(series.value, 0) : 0),
      0,
    ) ?? 0;
  const width = 800;
  const height = Math.max(250, (datum?.series.length ?? 1) * 38 + 92);
  const barStart = 270;
  const barWidth = width - barStart - 24;
  return (
    <figure aria-label={ariaLabel} className="analytics-plot analytics-plot--coverage" tabIndex={0}>
      <svg
        aria-hidden="true"
        className="analytics-plot__canvas"
        ref={canvasRef}
        role="img"
        style={{ fontSize }}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
      >
        <defs>
          <pattern
            id={hatchId}
            width="7"
            height="7"
            patternTransform="rotate(45)"
            patternUnits="userSpaceOnUse"
          >
            <line className="analytics-plot__hatch-line" x1="0" x2="0" y1="0" y2="7" />
          </pattern>
        </defs>
        <ChartLabel label={datum?.label ?? caption} x={8} y={42} />
        <ValueAxis
          end={barStart + barWidth}
          max={Math.max(total, 1)}
          start={barStart}
          unitLabel={axisUnit}
          y={56}
          gridBottom={height - 12}
        />
        {datum?.series.map((series, index) => {
          const value =
            series.value !== null && Number.isFinite(series.value) ? series.value : null;
          const segment = total > 0 && value !== null ? (Math.max(value, 0) / total) * barWidth : 0;
          const visibleWidth = value === null ? barWidth : segment;
          const y = 76 + index * 38;
          const abnormal = series.id !== 'valid';
          return (
            <g key={series.id}>
              <line
                className="analytics-plot__row-rule"
                x1={barStart}
                x2={barStart + barWidth}
                y1={y + 10}
                y2={y + 10}
              />
              <rect
                className={`analytics-plot__bar ${abnormal ? 'analytics-plot__bar--abnormal' : 'analytics-plot__bar--actual'} ${value === null ? 'analytics-plot__bar--missing' : ''}`}
                fill={abnormal || value === null ? `url(#${hatchId})` : undefined}
                height="20"
                width={visibleWidth}
                x={barStart}
                y={y}
              >
                <title>{`${series.label}: ${value === null ? '—' : compactAxisValue(value)}`}</title>
              </rect>
              <text className="analytics-plot__label" x="8" y={y + 14}>
                {series.label}
              </text>
              <text
                className="analytics-plot__value"
                x={Math.min(barStart + visibleWidth + 8, width - 16)}
                y={y + 15}
              >
                {value === null ? '—' : compactAxisValue(value)}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="analytics-plot__legend">
        {datum?.series.map((series) => (
          <span key={series.id}>
            <i
              aria-hidden="true"
              className={`analytics-plot__swatch ${series.id === 'valid' ? 'analytics-plot__swatch--actual' : 'analytics-plot__swatch--hatch'}`}
            />
            {series.label}: {series.valueText}
          </span>
        ))}
      </figcaption>
      <FallbackTable caption={caption} data={data} />
    </figure>
  );
}

const dashboardStrip = { width: 1200, left: 84, right: 1142, top: 40, bottom: 176 };

function dashboardOffset(at: string): string {
  const offset = new Intl.DateTimeFormat('en', {
    timeZone: presentationTimeZone,
    timeZoneName: 'longOffset',
  })
    .formatToParts(new Date(at))
    .find((part) => part.type === 'timeZoneName')?.value;
  return (offset ?? 'UTC').replace('GMT', 'UTC');
}

function dashboardTime(locale: Locale, at: number, includeDate: boolean): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: presentationTimeZone,
    ...(includeDate ? { month: 'short', day: '2-digit' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(at));
}

function tashkentDayStart(at: number): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: presentationTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(at));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((entry) => entry.type === type)?.value ?? '1');
  // Tashkent has a fixed UTC+05:00 civil offset. Day rules therefore align
  // to the presentation calendar rather than UTC midnight.
  return Date.UTC(part('year'), part('month') - 1, part('day')) - 5 * 60 * 60 * 1000;
}

function dashboardIntervalValues(data: readonly DashboardIntervalDatum[]): number[] {
  return data.flatMap((datum) =>
    [datum.actual, datum.planned].filter(
      (value): value is number => value !== null && Number.isFinite(value),
    ),
  );
}

function finiteChartValue(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? value : null;
}

/**
 * A chart-paper plot for the dashboard's actual aggregate intervals. Each
 * horizontal segment is an API-provided interval aggregate, never an inferred
 * point between readings. The exact values remain in the adjacent table.
 */
export function DashboardPlanActualChart({
  ariaLabel,
  caption,
  data,
  locale,
  unitLabel,
  aggregateNote,
  actualLabel,
  planLabel,
  intervalLabel,
  unavailableLabel = 'Not available',
}: {
  ariaLabel: string;
  caption: string;
  data: readonly DashboardIntervalDatum[];
  locale: Locale;
  unitLabel: string;
  aggregateNote: string;
  actualLabel: string;
  planLabel: string;
  intervalLabel: string;
  unavailableLabel?: string | undefined;
}) {
  const hatchId = useId();
  const canvasRef = useRef<SVGSVGElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(dashboardStrip.width);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const measure = () =>
      setCanvasWidth(canvas.getBoundingClientRect().width || dashboardStrip.width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);
  const values = dashboardIntervalValues(data);
  const minimum = Math.min(...values, 0);
  const maximum = Math.max(...values, 0);
  const scaleMinimum =
    minimum === maximum ? minimum - Math.max(Math.abs(minimum) * 0.05, 1) : minimum;
  const scaleMaximum =
    maximum === minimum ? maximum + Math.max(Math.abs(maximum) * 0.05, 1) : maximum;
  const magnitude = Math.max(Math.abs(scaleMinimum), Math.abs(scaleMaximum));
  const start = data.length ? Math.min(...data.map((datum) => new Date(datum.start).getTime())) : 0;
  const end = data.length ? Math.max(...data.map((datum) => new Date(datum.end).getTime())) : start;
  const range = Math.max(end - start, 1);
  const x = (at: string | number) =>
    dashboardStrip.left +
    ((new Date(at).getTime() - start) / range) * (dashboardStrip.right - dashboardStrip.left);
  const y = (value: number) =>
    dashboardStrip.bottom -
    ((value / magnitude - scaleMinimum / magnitude) /
      (scaleMaximum / magnitude - scaleMinimum / magnitude)) *
      (dashboardStrip.bottom - dashboardStrip.top);
  const hourly = range <= 72 * 60 * 60 * 1000;
  const step = hourly ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const firstTick = hourly
    ? Math.ceil(start / step) * step
    : tashkentDayStart(start) + (tashkentDayStart(start) < start ? step : 0);
  const ticks = Array.from(
    { length: Math.max(0, Math.floor((end - firstTick) / step) + 1) },
    (_, index) => firstTick + index * step,
  );
  const labelledTickEvery = Math.max(1, Math.ceil(ticks.length / 7));
  const offset = data[0] ? dashboardOffset(data[0].end) : 'UTC';
  const spansDays = tashkentDayStart(start) !== tashkentDayStart(end);

  return (
    <figure aria-label={ariaLabel} className="dashboard-strip-chart" tabIndex={0}>
      <svg
        aria-hidden="true"
        className="dashboard-strip-chart__canvas"
        ref={canvasRef}
        style={{ fontSize: `${(12 * dashboardStrip.width) / canvasWidth}px` }}
        preserveAspectRatio="xMinYMin meet"
        viewBox={`0 0 ${dashboardStrip.width} 246`}
        width="100%"
      >
        <defs>
          <pattern
            id={hatchId}
            width="7"
            height="7"
            patternTransform="rotate(45)"
            patternUnits="userSpaceOnUse"
          >
            <line className="dashboard-strip-chart__hatch-line" x1="0" x2="0" y1="0" y2="7" />
          </pattern>
        </defs>
        <rect
          className="dashboard-strip-chart__paper"
          height={dashboardStrip.bottom - dashboardStrip.top}
          width={dashboardStrip.right - dashboardStrip.left}
          x={dashboardStrip.left}
          y={dashboardStrip.top}
        />
        {ticks.map((tick, index) => (
          <g key={tick}>
            <line
              className={
                tick % (hourly ? 6 * step : 7 * step) === 0
                  ? 'dashboard-strip-chart__grid-major'
                  : 'dashboard-strip-chart__grid-minor'
              }
              x1={x(tick)}
              x2={x(tick)}
              y1={dashboardStrip.top}
              y2={dashboardStrip.bottom}
            />
            {index % labelledTickEvery === 0 ? (
              <text className="dashboard-strip-chart__tick" textAnchor="middle" x={x(tick)} y="198">
                {dashboardTime(locale, tick, !hourly || spansDays)}
              </text>
            ) : null}
          </g>
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
          <g key={ratio}>
            <line
              className={
                ratio === 0 || ratio === 1
                  ? 'dashboard-strip-chart__grid-major'
                  : 'dashboard-strip-chart__grid-minor'
              }
              x1={dashboardStrip.left}
              x2={dashboardStrip.right}
              y1={dashboardStrip.bottom - ratio * (dashboardStrip.bottom - dashboardStrip.top)}
              y2={dashboardStrip.bottom - ratio * (dashboardStrip.bottom - dashboardStrip.top)}
            />
            {values.length ? (
              <text
                className="dashboard-strip-chart__axis"
                textAnchor="end"
                x={dashboardStrip.left - 8}
                y={dashboardStrip.bottom - ratio * (dashboardStrip.bottom - dashboardStrip.top) + 4}
              >
                {compactAxisValue(scaleMinimum * (1 - ratio) + scaleMaximum * ratio)}
              </text>
            ) : null}
          </g>
        ))}
        <text className="dashboard-strip-chart__axis" x={dashboardStrip.left} y="31">
          {unitLabel}
        </text>
        {data.map((datum) => {
          const x1 = x(datum.start);
          const x2 = x(datum.end);
          return (
            <text
              className="dashboard-strip-chart__interval"
              key={`${datum.id}-label`}
              textAnchor="middle"
              x={(x1 + x2) / 2}
              y="18"
            >
              {datum.label}
            </text>
          );
        })}
        {data.map((datum) => {
          const x1 = x(datum.start);
          const x2 = x(datum.end);
          const actual = finiteChartValue(datum.actual);
          const planned = finiteChartValue(datum.planned);
          const actualMissing = actual === null;
          const planMissing = planned === null;
          const missing = actualMissing || planMissing;
          const missingLabel =
            actualMissing && planMissing
              ? unavailableLabel
              : `${actualMissing ? actualLabel : planLabel}: ${unavailableLabel}`;
          return (
            <g key={datum.id}>
              {missing ? (
                <>
                  <rect
                    className="dashboard-strip-chart__gap"
                    fill={`url(#${hatchId})`}
                    height={dashboardStrip.bottom - dashboardStrip.top}
                    width={Math.max(2, x2 - x1)}
                    x={x1}
                    y={dashboardStrip.top}
                  />
                  <text
                    className="dashboard-strip-chart__no-data"
                    textAnchor="middle"
                    x={(x1 + x2) / 2}
                    y={(dashboardStrip.top + dashboardStrip.bottom) / 2}
                  >
                    {missingLabel}
                  </text>
                </>
              ) : null}
              {actual !== null ? (
                <line
                  className="dashboard-strip-chart__actual"
                  x1={x1}
                  x2={x2}
                  y1={y(actual)}
                  y2={y(actual)}
                />
              ) : null}
              {planned !== null ? (
                <line
                  className="dashboard-strip-chart__plan"
                  x1={x1}
                  x2={x2}
                  y1={y(planned)}
                  y2={y(planned)}
                />
              ) : null}
            </g>
          );
        })}
        <text
          className="dashboard-strip-chart__time-zone"
          textAnchor="end"
          x={dashboardStrip.right}
          y="239"
        >
          {presentationTimeZone} {offset}
        </text>
        <text className="dashboard-strip-chart__aggregate-note" x={dashboardStrip.left} y="222">
          {aggregateNote}
        </text>
      </svg>
      <figcaption className="dashboard-strip-chart__legend">
        <span>
          <i
            aria-hidden="true"
            className="dashboard-strip-chart__swatch dashboard-strip-chart__swatch--actual"
          />
          {actualLabel}
        </span>
        <span>
          <i
            aria-hidden="true"
            className="dashboard-strip-chart__swatch dashboard-strip-chart__swatch--plan"
          />
          {planLabel}
        </span>
      </figcaption>
      <table className="visually-hidden">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{intervalLabel}</th>
            <th scope="col">{actualLabel}</th>
            <th scope="col">{planLabel}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((datum) => (
            <tr key={datum.id}>
              <th scope="row">
                {datum.label}: {`${datum.start} — ${datum.end}`}
              </th>
              <td>{datum.actualText}</td>
              <td>{datum.plannedText}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
