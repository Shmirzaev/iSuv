import type { ReactNode } from 'react';

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
    <text className="ops-chart__label" x={x} y={y}>
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
}: {
  max: number;
  start: number;
  end: number;
  y: number;
  negative?: boolean;
  unitLabel?: string | undefined;
}) {
  const ticks = [0, 0.5, 1];
  return (
    <g className="ops-chart__axis">
      <line className="ops-chart__baseline" x1={start} x2={end} y1={y} y2={y} />
      {ticks.map((ratio) => {
        const x = start + (end - start) * ratio;
        const value = negative ? -max + max * ratio : max * ratio;
        return (
          <g key={ratio}>
            <line className="ops-chart__baseline" x1={x} x2={x} y1={y - 4} y2={y + 4} />
            <text className="ops-chart__axis-label" textAnchor="middle" x={x} y={y - 8}>
              {compactAxisValue(value)}
            </text>
          </g>
        );
      })}
      {unitLabel ? (
        <text className="ops-chart__axis-label" textAnchor="end" x={end} y={y - 22}>
          {unitLabel}
        </text>
      ) : null}
    </g>
  );
}

/**
 * A dependency-free chart surface. The SVG is deliberately decorative: the
 * adjacent hidden table contains the exact values read by assistive technology.
 * This keeps a visual approximation from becoming an operational data source.
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
  const values = chartValues(data);
  const max = Math.max(...values, 1);
  const height = Math.max(240, data.length * 68 + 56);
  const plotWidth = chartRight - labelWidth - 76;
  const seriesCount = Math.max(data[0]?.series.length ?? 1, 1);
  const legend = data[0]?.series ?? [];
  return (
    <figure aria-label={ariaLabel} className="ops-chart ops-chart--grouped">
      <svg
        aria-hidden="true"
        className="ops-chart__canvas"
        role="img"
        viewBox={`0 0 ${chartWidth} ${height}`}
        width="100%"
      >
        <ValueAxis
          end={labelWidth + plotWidth}
          max={max}
          start={labelWidth}
          unitLabel={axisUnit}
          y={34}
        />
        {data.map((datum, index) => {
          const y = 50 + index * 68;
          return (
            <g key={datum.id}>
              <ChartLabel label={datum.label} x={8} y={y + 20} />
              {datum.series.map((series, seriesIndex) => {
                const value =
                  series.value !== null && Number.isFinite(series.value) ? series.value : null;
                const ratio = value === null ? 0 : Math.abs(value) / max;
                const barHeight = 20;
                const barY = y + seriesIndex * 28;
                const barWidth = Math.max(0, ratio * plotWidth);
                const valueX = Math.min(labelWidth + barWidth + 8, chartRight - 48);
                const valueLabel = value === null ? unavailableLabel : compactAxisValue(value);
                return (
                  <g key={series.id}>
                    <rect
                      className={`ops-chart__bar ops-chart__bar--${seriesIndex + 1}`}
                      height={barHeight}
                      rx="3"
                      width={barWidth}
                      x={labelWidth}
                      y={barY}
                    >
                      <title>{`${series.label}: ${valueLabel}`}</title>
                    </rect>
                    <text className="ops-chart__value" x={valueX} y={barY + 15}>
                      {valueLabel}
                    </text>
                  </g>
                );
              })}
              {seriesCount > 1 ? null : (
                <line
                  className="ops-chart__baseline"
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
      <figcaption className="ops-chart__legend">
        {legend.map((series, index) => (
          <span key={series.id}>
            <i aria-hidden="true" className={`ops-chart__swatch ops-chart__bar--${index + 1}`} />
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
  const values = chartValues(data);
  const max = Math.max(...values, 1);
  const height = Math.max(240, data.length * 52 + 56);
  const midpoint = 510;
  const plotWidth = 240;
  return (
    <figure aria-label={ariaLabel} className="ops-chart ops-chart--signed">
      <svg
        aria-hidden="true"
        className="ops-chart__canvas"
        role="img"
        viewBox={`0 0 ${chartWidth} ${height}`}
        width="100%"
      >
        <line className="ops-chart__zero" x1={midpoint} x2={midpoint} y1="38" y2={height - 12} />
        <ValueAxis
          end={midpoint}
          max={max}
          negative
          start={midpoint - plotWidth}
          unitLabel={axisUnit}
          y={34}
        />
        <ValueAxis end={midpoint + plotWidth} max={max} start={midpoint} y={34} />
        {data.map((datum, index) => {
          const candidate = datum.series[0]?.value ?? null;
          const value = candidate !== null && Number.isFinite(candidate) ? candidate : null;
          const y = 54 + index * 52;
          const magnitude = value === null ? 0 : (Math.abs(value) / max) * plotWidth;
          const x = value === null || value >= 0 ? midpoint : midpoint - magnitude;
          const valueLabel = value === null ? unavailableLabel : compactAxisValue(value);
          return (
            <g key={datum.id}>
              <ChartLabel label={datum.label} x={8} y={y + 16} />
              <rect
                className={`ops-chart__bar ${value === null ? 'ops-chart__bar--empty' : value >= 0 ? 'ops-chart__bar--positive' : 'ops-chart__bar--negative'}`}
                height="20"
                rx="3"
                width={magnitude}
                x={x}
                y={y}
              >
                <title>{valueLabel}</title>
              </rect>
              <text
                className="ops-chart__value"
                textAnchor={value !== null && value < 0 ? 'end' : 'start'}
                x={
                  value !== null && value < 0
                    ? Math.max(x - 8, midpoint - plotWidth)
                    : Math.min(x + magnitude + 8, midpoint + plotWidth)
                }
                y={y + 15}
              >
                {valueLabel}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="ops-chart__legend">
        {data[0]?.series.map((series, index) => (
          <span key={series.id}>
            <i aria-hidden="true" className={`ops-chart__swatch ops-chart__bar--${index + 1}`} />
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
}: {
  ariaLabel: string;
  caption: string;
  data: readonly ChartDatum[];
}) {
  const datum = data[0];
  const total =
    datum?.series.reduce(
      (sum, series) =>
        sum +
        (series.value !== null && Number.isFinite(series.value) ? Math.max(series.value, 0) : 0),
      0,
    ) ?? 0;
  const width = 640;
  const height = 240;
  const barStart = 220;
  const barWidth = width - barStart - 24;
  let offset = barStart;
  return (
    <figure aria-label={ariaLabel} className="ops-chart ops-chart--stacked">
      <svg
        aria-hidden="true"
        className="ops-chart__canvas"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
      >
        <ChartLabel label={datum?.label ?? caption} x={8} y={115} />
        <ValueAxis end={barStart + barWidth} max={Math.max(total, 1)} start={barStart} y={82} />
        <rect
          className="ops-chart__track"
          height="36"
          rx="5"
          width={barWidth}
          x={barStart}
          y="100"
        />
        {datum?.series.map((series, index) => {
          const value =
            series.value !== null && Number.isFinite(series.value) ? series.value : null;
          const segment = total > 0 && value !== null ? (Math.max(value, 0) / total) * barWidth : 0;
          const currentOffset = offset;
          offset += segment;
          return (
            <rect
              className={`ops-chart__bar ops-chart__bar--${index + 1}`}
              height="36"
              key={series.id}
              width={segment}
              x={currentOffset}
              y="100"
            >
              <title>{`${series.label}: ${value === null ? '—' : compactAxisValue(value)}`}</title>
            </rect>
          );
        })}
      </svg>
      <figcaption className="ops-chart__legend">
        {datum?.series.map((series, index) => (
          <span key={series.id}>
            <i aria-hidden="true" className={`ops-chart__swatch ops-chart__bar--${index + 1}`} />
            {series.label}: {series.valueText}
          </span>
        ))}
      </figcaption>
      <FallbackTable caption={caption} data={data} />
    </figure>
  );
}
