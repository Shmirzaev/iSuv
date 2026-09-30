import { useEffect, useRef, useState } from 'react';
import {
  liveOperationsResponseSchema,
  mapNetworkResponseSchema,
  playbackResponseSchema,
  traceResponseSchema,
  type MapNetworkResponse,
  type PlaybackResponse,
  type TraceResponse,
} from '@isuv/contracts';
import { translate, type Locale, type TranslationKey } from '@isuv/i18n';
import {
  formatDecimal,
  formatMeasurementValue,
  measurementUnitLabel,
  presentationTimestamp,
  type MeasurementUnit,
} from './format.js';
import { WorkspaceHeader } from './workspace-header.js';
import { Icon, GlyphIcon } from './icons.js';
import { joinProvenance } from './provenance-text.js';
import {
  initialMapDetail,
  mapNetworkPath,
  mapStatePresentation,
  markerState,
  playbackFrame,
  playbackPath,
  tracePath,
  type MapDetail,
  type MapSelection,
} from './map-network-model.js';

const t = (locale: Locale, key: TranslationKey) => translate(locale, key);
type State = 'loading' | 'ready' | 'empty' | 'unauthenticated' | 'forbidden' | 'unavailable';

function MapTime({ locale, value }: { locale: Locale; value: string | null }) {
  if (!value)
    return (
      <span aria-label={t(locale, 'notAvailable')}>
        <GlyphIcon glyph="-" />
      </span>
    );
  const timestamp = presentationTimestamp(locale, value);
  return (
    <time dateTime={timestamp.dateTime} title={timestamp.title}>
      {timestamp.value}
    </time>
  );
}

function formatQuantityValue(locale: Locale, value: string | number | null): string {
  return value === null ? '—' : formatDecimal(locale, value);
}

function stripTerminalPunctuation(value: string): string {
  return value.trim().replace(/[\s;.,:]+$/u, '');
}

type PanelQuantity =
  | NonNullable<MapNetworkResponse['panel']>['stage']
  | NonNullable<MapNetworkResponse['panel']>['discharge']
  | NonNullable<MapNetworkResponse['panel']>['counter'];

function mapUnit(unit: MeasurementUnit): string {
  return measurementUnitLabel(unit);
}

function Quantity({
  locale,
  label,
  value,
}: {
  locale: Locale;
  label: TranslationKey;
  value: PanelQuantity;
}) {
  const p = mapStatePresentation(value.state);
  const unit = mapUnit(value.unit);
  const reading = value.value;
  return (
    <div className={`map-quantity map-quantity--${value.state}`} data-state={value.state}>
      <dt>
        {t(locale, label)} <span className="map-quantity__unit">({unit})</span>
      </dt>
      <dd>
        <GlyphIcon glyph={p.icon} />{' '}
        {reading === null ? (
          <strong className="map-quantity__unavailable">{t(locale, 'notAvailable')}</strong>
        ) : (
          <data
            className="map-quantity__reading"
            value={reading}
            title={reading}
            aria-label={`${t(locale, label)}: ${reading} ${unit}`}
          >
            {formatMeasurementValue(locale, reading, value.unit)} {unit}
          </data>
        )}
        <small className="map-quantity__status">
          {t(locale, p.label)}: {t(locale, p.value)}
        </small>
        <small>
          {t(locale, 'mapObservedAt')}: <MapTime locale={locale} value={value.observedAt} />
        </small>
        <small>
          {t(locale, 'mapIngestedAt')}: <MapTime locale={locale} value={value.ingestedAt} />
        </small>
        <small>
          {t(locale, 'source')}: {joinProvenance([value.source.label, value.source.provenance])}
        </small>
      </dd>
    </div>
  );
}
type UnconfiguredValue = NonNullable<MapNetworkResponse['panel']>['targetDischarge'];

function unconfiguredUnit(label: TranslationKey): MeasurementUnit | null {
  if (label === 'mapTargetDischarge') return 'm3/s';
  if (label === 'deliveredVolume' || label === 'plannedVolume' || label === 'unexplainedBalance')
    return 'm3';
  return null;
}

function Unconfigured({
  locale,
  label,
  value,
}: {
  locale: Locale;
  label: TranslationKey;
  value: UnconfiguredValue;
}) {
  const unit = unconfiguredUnit(label);
  return (
    <div className="map-unconfigured">
      <dt>
        {t(locale, label)}{' '}
        {unit ? <span className="map-quantity__unit">({mapUnit(unit)})</span> : null}
      </dt>
      <dd>
        <span className="map-quantity__glyph" aria-hidden="true">
          <Icon name="not_configured" />
        </span>{' '}
        <strong>{t(locale, 'mapUnconfigured')}</strong>
        <small>{value.reason}</small>
        <small>
          {t(locale, 'source')}: {t(locale, 'mapUnconfigured')}
        </small>
      </dd>
    </div>
  );
}
function HealthStatus({
  locale,
  label,
  icon,
  stateLabel,
  detail,
  attention = false,
}: {
  locale: Locale;
  label: TranslationKey;
  icon: string;
  stateLabel: TranslationKey;
  detail: TranslationKey;
  attention?: boolean;
}) {
  return (
    <div className={`map-health__status${attention ? ' map-health--abnormal' : ''}`}>
      <dt>{t(locale, label)}</dt>
      <dd>
        <span className="map-health__glyph" aria-hidden="true">
          <GlyphIcon glyph={icon} />
        </span>{' '}
        <strong>{t(locale, stateLabel)}</strong>
        <small>{t(locale, detail)}</small>
      </dd>
    </div>
  );
}
export function StatusLegend({ locale, heading = true }: { locale: Locale; heading?: boolean }) {
  return (
    <section className="map-legend" aria-labelledby="map-legend-heading">
      <h3 id="map-legend-heading" className={heading ? undefined : 'visually-hidden'}>
        {t(locale, 'mapLegend')}
      </h3>
      <ul>
        {(['over', 'on_plan', 'under', 'no_data', 'unreliable'] as const).map((state) => {
          const p = mapStatePresentation(state);
          return (
            <li key={state} className={`map-legend__state map-status--${state}`}>
              <span className="map-legend__glyph" aria-hidden="true">
                <GlyphIcon glyph={p.icon} />
              </span>
              <strong>{t(locale, p.label)}</strong>
              <small>{t(locale, p.value)}</small>
            </li>
          );
        })}
        <li className="map-legend__state map-status--device_fault">
          <span className="map-legend__glyph" aria-hidden="true">
            <Icon name="fault" />
          </span>
          <strong>{t(locale, 'mapDeviceFault')}</strong>
          <small>{t(locale, 'statusUnreliableValue')}</small>
        </li>
      </ul>
    </section>
  );
}
export function Geometry({
  locale,
  response,
  selection,
  trace,
  layers,
  onSelect,
  stationCodes = {},
}: {
  locale: Locale;
  response: MapNetworkResponse;
  selection: MapSelection;
  trace: TraceResponse | null;
  layers: Record<string, boolean>;
  onSelect: (stationId: string, deviceId: string) => void;
  stationCodes?: Readonly<Record<string, string>>;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [viewport, setViewport] = useState({ width: 600, height: 300 });
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  useEffect(() => {
    if (!svg.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0 && entry.contentRect.height > 0)
        setViewport({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(svg.current);
    return () => observer.disconnect();
  }, []);
  const visibleSections = response.layers.sections.filter(
    (section) => layers.sections || trace?.edges.some((edge) => edge.sectionId === section.id),
  );
  const visibleStations = response.layers.stations.filter(
    (station) => layers.stations || station.id === selection.stationId,
  );
  const all = [
    ...(layers.waterways
      ? response.layers.waterways.flatMap((x) =>
          x.geometry.type === 'LineString' ? x.geometry.coordinates : x.geometry.coordinates.flat(),
        )
      : []),
    ...visibleSections.flatMap((x) => x.geometry.coordinates),
    ...(layers.junctions ? response.layers.junctions.map((x) => x.geometry.coordinates) : []),
    ...visibleStations.map((x) => x.geometry.coordinates),
  ];
  const xs = all.map((x) => x[0]),
    ys = all.map((x) => x[1]);
  const minX = xs.length > 0 ? Math.min(...xs) : 0,
    maxX = xs.length > 0 ? Math.max(...xs) : 1,
    minY = ys.length > 0 ? Math.min(...ys) : 0,
    maxY = ys.length > 0 ? Math.max(...ys) : 1;
  const projectedPoint = ([x, y]: [number, number]): readonly [number, number] => [
    20 + ((x - minX) / (maxX - minX || 1)) * 560,
    280 - ((y - minY) / (maxY - minY || 1)) * 240,
  ];
  // Fit the existing projection to the viewport, without moving any feature relative
  // to another. Screen-space symbols and labels keep their size and circular shape.
  const point = (coordinates: [number, number]): readonly [number, number] => {
    const [x, y] = projectedPoint(coordinates);
    return [(x * viewport.width) / 600, (y * viewport.height) / 300];
  };
  const points = (coordinates: readonly [number, number][]) =>
    coordinates
      .map(point)
      .map(([x, y]) => `${x},${y}`)
      .join(' ');
  // These ranges describe supplied coordinates, not inferred basin identities.
  const longitudeStarts = [...xs]
    .sort((a, b) => a - b)
    .filter((value, index, values) => index === 0 || value - values[index - 1]! > 0.5);
  const coordinateRanges = longitudeStarts.map((start, index) => {
    const next = longitudeStarts[index + 1] ?? Infinity;
    const end = Math.max(...xs.filter((value) => value >= start && value < next));
    return { start, end, center: point([(start + end) / 2, maxY])[0] };
  });
  return (
    <svg
      ref={svg}
      className="map-svg"
      viewBox={`0 0 ${viewport.width} ${viewport.height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={t(locale, 'mapGeographicAria')}
    >
      <title>{t(locale, 'mapGeographicAria')}</title>
      <defs>
        <pattern
          id="map-station-hatch"
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line x1="0" y1="0" x2="0" y2="6" />
        </pattern>
      </defs>
      {coordinateRanges.map((range) => (
        <text
          key={range.start}
          className="map-coordinate-group"
          x={range.center}
          y="14"
          textAnchor="middle"
        >
          <tspan x={range.center}>{t(locale, 'mapCoordinateGroup')}</tspan>
          <tspan x={range.center} dy="13">
            {range.start.toFixed(1)}–{range.end.toFixed(1)}°
          </tspan>
        </text>
      ))}
      {layers.waterways
        ? response.layers.waterways.flatMap((x) =>
            (x.geometry.type === 'LineString'
              ? [x.geometry.coordinates]
              : x.geometry.coordinates
            ).map((coordinates, component) => (
              <polyline
                key={`${x.id}-${component}`}
                className="map-waterway"
                points={points(coordinates)}
              />
            )),
          )
        : null}
      {visibleSections.map((x) => (
        <polyline
          key={x.id}
          className={
            trace?.edges.some((edge) => edge.sectionId === x.id)
              ? 'map-section map-section--trace'
              : 'map-section'
          }
          points={points(x.geometry.coordinates)}
        />
      ))}
      {layers.junctions
        ? response.layers.junctions.map((x) => {
            const [cx, cy] = point(x.geometry.coordinates);
            return <circle key={x.id} className="map-junction" cx={cx} cy={cy} r="1.5" />;
          })
        : null}
      {visibleStations.map((x) => {
        const [cx, cy] = point(x.geometry.coordinates);
        const selected = selection.stationId === x.id;
        const state =
          selected && response.panel?.stationId === x.id
            ? response.panel.health.fault === 'reported'
              ? 'device_fault'
              : markerState(response.panel)
            : null;
        const selectable = x.deviceId !== null;
        const selectStation = () => {
          if (x.deviceId) onSelect(x.id, x.deviceId);
        };
        return (
          <g
            key={x.id}
            className={selectable ? 'map-station-feature' : undefined}
            role={selectable ? 'button' : undefined}
            tabIndex={selectable ? 0 : undefined}
            aria-label={selectable ? `${t(locale, 'mapSelect')} ${x.id}` : undefined}
            aria-pressed={selectable ? selected : undefined}
            onClick={selectable ? selectStation : undefined}
            onMouseEnter={() => setHovered(x.id)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setFocused(x.id)}
            onBlur={() => setFocused(null)}
            onKeyDown={
              selectable
                ? (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      selectStation();
                    }
                  }
                : undefined
            }
          >
            <title>
              {state
                ? `${x.id}: ${t(locale, state === 'device_fault' ? 'mapDeviceFault' : mapStatePresentation(state).label)}`
                : `${x.id}: ${t(locale, 'notAvailable')}`}
            </title>
            <circle
              className={`map-station${state ? ` map-status--${state}` : ''}${selected ? ' map-station--selected' : ''}`}
              cx={cx}
              cy={cy}
              r={selected ? 5 : 3}
              style={
                state && state !== 'reported' ? { fill: 'url(#map-station-hatch)' } : undefined
              }
            />
          </g>
        );
      })}
      {/* Draw labels last so other stations and waterways cannot cover them. */}
      {visibleStations
        .filter((x) => [selection.stationId, hovered, focused].includes(x.id))
        .map((x) => {
          const [cx, cy] = point(x.geometry.coordinates);
          const selected = selection.stationId === x.id;
          const state =
            selected && response.panel?.stationId === x.id
              ? response.panel.health.fault === 'reported'
                ? 'device_fault'
                : markerState(response.panel)
              : null;
          const status = state
            ? t(
                locale,
                state === 'device_fault' ? 'mapDeviceFault' : mapStatePresentation(state).label,
              )
            : t(locale, 'notAvailable');
          const code = stationCodes[x.id] ?? x.id;
          const labelWidth = Math.min(
            viewport.width - 16,
            Math.max(code.length * 7.25, selected ? status.length * 7.25 + 20 : 0),
          );
          const labelX =
            cx > viewport.width / 2
              ? Math.max(labelWidth + 8, Math.min(viewport.width - 8, cx))
              : Math.max(8, Math.min(viewport.width - labelWidth - 8, cx));
          return (
            <g key={x.id}>
              <text
                className="map-station-label"
                x={labelX}
                y={cy > viewport.height - 50 ? cy - 30 : cy + 18}
                textAnchor={cx > viewport.width / 2 ? 'end' : 'start'}
              >
                <tspan>{code}</tspan>
                {selected ? (
                  <tspan x={cx > viewport.width / 2 ? labelX : labelX + 18} dy="15">
                    {status}
                  </tspan>
                ) : null}
              </text>
              {selected ? (
                <g
                  transform={`translate(${cx > viewport.width / 2 ? labelX - status.length * 7.25 - 18 : labelX},${(cy > viewport.height - 50 ? cy - 30 : cy + 18) + 2})`}
                >
                  <Icon
                    name={
                      state === 'device_fault'
                        ? 'fault'
                        : state === 'unreliable'
                          ? 'unreliable'
                          : state === 'no_data'
                            ? 'no_data'
                            : state === 'reported'
                              ? 'reported'
                              : 'not_configured'
                    }
                  />
                </g>
              ) : null}
            </g>
          );
        })}
    </svg>
  );
}
function Topology({
  locale,
  detail,
  response,
  selection,
  trace,
}: {
  locale: Locale;
  detail: MapDetail;
  response: MapNetworkResponse;
  selection: MapSelection;
  trace: TraceResponse | null;
}) {
  const junctions = response.layers.junctions;
  const topologyWidth = 820;
  const topologyHeight = 420;
  const longitudes = junctions.map((node) => node.geometry.coordinates[0]);
  const latitudes = junctions.map((node) => node.geometry.coordinates[1]);
  const minLongitude = longitudes.length > 0 ? Math.min(...longitudes) : 0;
  const maxLongitude = longitudes.length > 0 ? Math.max(...longitudes) : 1;
  const minLatitude = latitudes.length > 0 ? Math.min(...latitudes) : 0;
  const maxLatitude = latitudes.length > 0 ? Math.max(...latitudes) : 1;
  const projectTopologyPoint = ([longitude, latitude]: readonly [number, number]) =>
    [
      20 + ((longitude - minLongitude) / (maxLongitude - minLongitude || 1)) * 780,
      400 - ((latitude - minLatitude) / (maxLatitude - minLatitude || 1)) * 360,
    ] as const;
  // This is the geographic map's extent fit in the topology viewBox. The old ordinal
  // graph grid connected unrelated nodes into decorative diamonds.
  const positions = new Map(
    junctions.map((node) => [node.id, projectTopologyPoint(node.geometry.coordinates)]),
  );
  const coordinateColumns = (() => {
    const starts = [...longitudes]
      .sort((a, b) => a - b)
      .filter((value, index, values) => index === 0 || value - values[index - 1]! > 0.5);
    return starts.map((start, index) => {
      const end = starts[index + 1] ?? maxLongitude + 0.5;
      const members = junctions.filter(
        (node) => node.geometry.coordinates[0] >= start && node.geometry.coordinates[0] < end,
      );
      const center =
        members.reduce((total, node) => total + node.geometry.coordinates[0], 0) /
        (members.length || 1);
      const endLongitude = Math.max(...members.map((node) => node.geometry.coordinates[0]), start);
      return { center, startLongitude: start, endLongitude };
    });
  })();
  const selectedJunction = response.layers.stations.find(
    (station) => station.id === selection.stationId,
  )?.junctionId;
  const selectedState =
    response.panel?.stationId === selection.stationId
      ? response.panel.health.fault === 'reported'
        ? 'device_fault'
        : markerState(response.panel)
      : null;
  return (
    <div className="map-topology">
      <p>{t(locale, 'mapCurrentTopology')}</p>
      {detail !== 'network' ? (
        <p>{t(locale, 'mapNetwork')}</p>
      ) : (
        <>
          <svg
            className="map-topology-svg"
            viewBox={`0 0 ${topologyWidth} ${topologyHeight}`}
            role="img"
            aria-label={t(locale, 'mapTopologyAria')}
          >
            <title>{t(locale, 'mapTopologyAria')}</title>
            <defs>
              <pattern
                id="map-topology-node-hatch"
                width="6"
                height="6"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <line x1="0" y1="0" x2="0" y2="6" />
              </pattern>
              <marker
                id="map-topology-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" />
              </marker>
            </defs>
            {coordinateColumns.map((column) => {
              const [x] = projectTopologyPoint([column.center, maxLatitude]);
              return (
                <text
                  key={column.startLongitude}
                  className="map-topology-basin-label"
                  x={x}
                  y="18"
                  textAnchor="middle"
                >
                  {t(locale, 'mapCoordinateGroup')} {column.startLongitude.toFixed(1)}–
                  {column.endLongitude.toFixed(1)}
                </text>
              );
            })}
            {response.layers.sections.map((section) => {
              const geometryStart = section.geometry.coordinates[0]!;
              const geometryEnd = section.geometry.coordinates.at(-1)!;
              const from = section.upstreamJunctionId
                ? (positions.get(section.upstreamJunctionId) ?? projectTopologyPoint(geometryStart))
                : projectTopologyPoint(geometryStart);
              const to = section.downstreamJunctionId
                ? (positions.get(section.downstreamJunctionId) ?? projectTopologyPoint(geometryEnd))
                : projectTopologyPoint(geometryEnd);
              if (!from || !to) return null;
              const traced = trace?.edges.some((edge) => edge.sectionId === section.id);
              return (
                <line
                  key={section.id}
                  className={
                    traced ? 'map-topology-edge map-topology-edge--trace' : 'map-topology-edge'
                  }
                  x1={from?.[0]}
                  y1={from?.[1]}
                  x2={to?.[0]}
                  y2={to?.[1]}
                  markerEnd="url(#map-topology-arrow)"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
            {junctions.map((node) => {
              const at = positions.get(node.id)!;
              const selected = node.id === selectedJunction;
              const traced = trace?.nodes.includes(node.id);
              return (
                <g key={node.id}>
                  <circle
                    className={`map-topology-node${selected && selectedState ? ` map-status--${selectedState}` : ''}${selected ? ' map-topology-node--selected' : ''}${traced ? ' map-topology-node--trace' : ''}`}
                    cx={at[0]}
                    cy={at[1]}
                    r="2.5"
                    vectorEffect="non-scaling-stroke"
                    style={
                      selected && selectedState && selectedState !== 'reported'
                        ? { fill: 'url(#map-topology-node-hatch)' }
                        : undefined
                    }
                  />
                  {selected || traced ? (
                    <text x={at[0] + (selected ? 20 : 5)} y={at[1]}>
                      {selected && selectedState
                        ? t(
                            locale,
                            selectedState === 'device_fault'
                              ? 'mapDeviceFault'
                              : mapStatePresentation(selectedState).label,
                          )
                        : node.id.slice(0, 8)}
                    </text>
                  ) : null}
                  {selected ? (
                    <g transform={`translate(${at[0] + 5},${at[1] - 10}) scale(.72)`}>
                      <Icon
                        name={
                          selectedState === 'device_fault'
                            ? 'fault'
                            : selectedState === 'unreliable'
                              ? 'unreliable'
                              : selectedState === 'no_data'
                                ? 'no_data'
                                : selectedState === 'reported'
                                  ? 'reported'
                                  : 'not_configured'
                        }
                      />
                    </g>
                  ) : null}
                </g>
              );
            })}
          </svg>
          <ol aria-label={t(locale, 'mapTrace')}>
            {trace?.edges.map((edge) => (
              <li key={edge.sectionId}>
                {edge.from ?? t(locale, 'mapBoundary')} <GlyphIcon glyph="→" />{' '}
                {edge.to ?? t(locale, 'mapBoundary')}{' '}
                {edge.boundary ? `(${t(locale, 'mapBoundary')})` : ''}
              </li>
            ))}
          </ol>
          <details className="map-topology-paths">
            <summary>
              {t(locale, 'mapCurrentTopology')} — {t(locale, 'mapSections')}
            </summary>
            <ol>
              {response.layers.sections.map((section) => (
                <li key={section.id}>
                  {section.upstreamJunctionId ?? t(locale, 'mapBoundary')} <GlyphIcon glyph="→" />{' '}
                  {section.downstreamJunctionId ?? t(locale, 'mapBoundary')}{' '}
                  {section.boundary ? `(${t(locale, 'mapBoundary')})` : ''}
                </li>
              ))}
            </ol>
          </details>
        </>
      )}
    </div>
  );
}
function Panel({
  locale,
  response,
  onTrace,
  onClose,
  trace,
  playback,
  frame,
  onFrame,
}: {
  locale: Locale;
  response: MapNetworkResponse;
  onTrace: (direction: TraceResponse['direction']) => void;
  onClose: () => void;
  trace: TraceResponse | null;
  playback: PlaybackResponse | null;
  frame: number;
  onFrame: (n: number) => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [response.panel?.stationId]);
  const panel = response.panel;
  if (!panel)
    return (
      <section className="map-panel map-panel--empty" aria-labelledby="map-panel-heading">
        <h3 id="map-panel-heading">{t(locale, 'mapPanel')}</h3>
        <p>{t(locale, 'mapNoSelection')}</p>
      </section>
    );
  const current = markerState(panel),
    p =
      panel.health.fault === 'reported'
        ? {
            icon: '!',
            label: 'mapDeviceFault' as TranslationKey,
            value: 'statusUnreliableValue' as TranslationKey,
          }
        : mapStatePresentation(current),
    f = playbackFrame(playback, frame);
  return (
    <aside className="map-panel" aria-labelledby="map-panel-heading">
      <button className="action-button" type="button" onClick={onClose}>
        {t(locale, 'mapClose')}
      </button>
      <h2 id="map-panel-heading" ref={heading} tabIndex={-1}>
        {t(locale, 'mapPanel')}
      </h2>
      <p
        className={`map-panel__status map-status--${panel.health.fault === 'reported' ? 'device_fault' : current}`}
      >
        <GlyphIcon glyph={p.icon} /> <strong>{t(locale, p.label)}</strong> — {t(locale, p.value)}
      </p>
      <p>
        {t(locale, 'mapResponsibleTerritory')}: {panel.responsibleTerritory.name} (
        {panel.responsibleTerritory.code})
      </p>
      <dl className="map-panel__values map-panel__ledger">
        <Quantity locale={locale} label="stage" value={panel.stage} />
        <Quantity locale={locale} label="discharge" value={panel.discharge} />
        <Quantity locale={locale} label="liveCounter" value={panel.counter} />
        <Unconfigured locale={locale} label="mapTargetDischarge" value={panel.targetDischarge} />
        <Unconfigured locale={locale} label="deliveredVolume" value={panel.deliveredVolume} />
        <Unconfigured locale={locale} label="plannedVolume" value={panel.plannedVolume} />
        <Unconfigured locale={locale} label="liveVariance" value={panel.variance} />
        <Unconfigured locale={locale} label="mapDuration" value={panel.duration} />
        <Unconfigured locale={locale} label="systemConfidence" value={panel.confidence} />
        <Unconfigured locale={locale} label="unexplainedBalance" value={panel.balance} />
      </dl>
      <dl className="map-health">
        <HealthStatus
          locale={locale}
          label="liveConnection"
          icon={panel.health.connection === 'communicating' ? '✓' : '!'}
          stateLabel={
            panel.health.connection === 'communicating'
              ? 'liveCommunicating'
              : panel.health.connection === 'offline'
                ? 'liveOffline'
                : 'liveUnknown'
          }
          detail={
            panel.health.connection === 'communicating'
              ? 'livePacketsReceived'
              : panel.health.connection === 'offline'
                ? 'liveNoConnection'
                : 'liveConnectionConditionUnknown'
          }
          attention={false}
        />
        <HealthStatus
          locale={locale}
          label="liveFault"
          icon={panel.health.fault === 'none' ? '✓' : '!'}
          stateLabel={
            panel.health.fault === 'reported'
              ? 'liveFault'
              : panel.health.fault === 'none'
                ? 'liveNoFault'
                : 'liveUnknown'
          }
          detail={
            panel.health.fault === 'reported'
              ? 'liveFaultReported'
              : panel.health.fault === 'none'
                ? 'liveFaultNotReported'
                : 'liveFaultConditionUnknown'
          }
          attention={panel.health.fault === 'reported'}
        />
        <HealthStatus
          locale={locale}
          label="dataState"
          icon={panel.health.dataCondition === 'current' ? '✓' : '!'}
          stateLabel={
            panel.health.dataCondition === 'current'
              ? 'liveDataCurrent'
              : panel.health.dataCondition === 'stale'
                ? 'liveDataStale'
                : panel.health.dataCondition === 'unreliable'
                  ? 'statusUnreliable'
                  : panel.health.dataCondition === 'no_data'
                    ? 'noData'
                    : 'liveUnknown'
          }
          detail={
            panel.health.dataCondition === 'current'
              ? 'liveCurrentEvidence'
              : panel.health.dataCondition === 'stale'
                ? 'liveStaleEvidence'
                : panel.health.dataCondition === 'unreliable'
                  ? 'statusUnreliableValue'
                  : panel.health.dataCondition === 'no_data'
                    ? 'statusNoObservation'
                    : 'liveConditionUnknown'
          }
          attention={['no_data', 'unreliable', 'stale'].includes(panel.health.dataCondition)}
        />
      </dl>
      <p>
        {t(locale, 'source')}:{' '}
        {joinProvenance([panel.health.source.label, panel.health.source.provenance])}
      </p>
      <a
        className="action-link"
        href={`#operations?deviceId=${response.layers.stations.find((x) => x.id === panel.stationId)?.deviceId ?? ''}`}
      >
        {t(locale, 'mapOpenLive')}
      </a>
      <section>
        <h3>{t(locale, 'mapTrace')}</h3>
        <button className="action-button" type="button" onClick={() => onTrace('upstream')}>
          {t(locale, 'mapUpstream')}
        </button>{' '}
        <button className="action-button" type="button" onClick={() => onTrace('downstream')}>
          {t(locale, 'mapDownstream')}
        </button>
        {trace ? (
          <>
            <p>{trace.disclaimer}</p>
            <ol>
              {trace.nodes.map((node) => (
                <li key={node}>{node}</li>
              ))}
            </ol>
            {trace.truncated ? <p>{t(locale, 'mapTraceTruncated')}</p> : null}
          </>
        ) : (
          <p>{t(locale, 'mapNoTrace')}</p>
        )}
      </section>
      <section>
        <h3>{t(locale, 'mapPlayback')}</h3>
        <p>{t(locale, 'mapPlaybackDetail')}</p>
        {playback ? (
          <>
            <label>
              {t(locale, 'mapFrame')}{' '}
              <input
                type="range"
                min="0"
                max="23"
                value={frame}
                onInput={(e) => onFrame(Number(e.currentTarget.value))}
              />
            </label>
            <p>
              {f?.gap
                ? t(locale, 'mapGap')
                : `${t(locale, 'mapRaw')}: ${f?.raw ?? '—'} m; ${t(locale, 'mapValidated')}: ${f?.validated ?? '—'} m`}
            </p>
            <p>{playback.disclaimer}</p>
          </>
        ) : null}
      </section>
    </aside>
  );
}
export function MapNetworkWorkspace({
  locale,
  access,
  selection,
  onSelection,
}: {
  locale: Locale;
  access: 'loading' | 'ready' | 'unauthenticated' | 'unavailable';
  selection: MapSelection;
  onSelection: (s: MapSelection) => void;
}) {
  const [detail, setDetail] = useState<MapDetail>(
      selection.stationId ? initialMapDetail(selection) : 'network',
    ),
    [response, setResponse] = useState<MapNetworkResponse | null>(null),
    [state, setState] = useState<State>('loading'),
    [layers, setLayers] = useState({
      waterways: true,
      junctions: false,
      sections: false,
      stations: true,
    }),
    [trace, setTrace] = useState<TraceResponse | null>(null),
    [playback, setPlayback] = useState<PlaybackResponse | null>(null),
    [frame, setFrame] = useState(0),
    [retry, setRetry] = useState(0);
  const returnFocus = useRef<string | null>(null);
  const [stationCodes, setStationCodes] = useState<Record<string, string>>({});
  useEffect(() => {
    setStationCodes({});
    if (access !== 'ready') return;
    const controller = new AbortController();
    // Facets supply the authorized station directory independently of row pagination.
    void fetch('/api/v1/live-operations?limit=1', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const parsed = liveOperationsResponseSchema.safeParse(await response.json());
        if (parsed.success && !controller.signal.aborted)
          setStationCodes(
            Object.fromEntries(
              parsed.data.facets.stations.map((station) => [station.id, station.code]),
            ),
          );
      })
      .catch(() => {
        /* Keep the exact station ID if codes are unavailable. */
      });
    return () => controller.abort();
  }, [access]);
  useEffect(() => {
    if (selection.stationId) setDetail('network');
  }, [selection.stationId]);
  useEffect(() => {
    if (!selection.stationId && !response?.panel && state === 'ready' && returnFocus.current) {
      document.getElementById(returnFocus.current)?.focus();
      returnFocus.current = null;
    }
  }, [response?.panel, selection.stationId, state]);
  useEffect(() => {
    if (access === 'loading') {
      setState('loading');
      return;
    }
    if (access !== 'ready') {
      setState(access);
      return;
    }
    const c = new AbortController();
    setState('loading');
    void fetch(mapNetworkPath(detail, selection), { signal: c.signal })
      .then(async (r) => {
        const body: unknown = await r.json().catch(() => null);
        const parsed = mapNetworkResponseSchema.safeParse(body);
        if (r.ok && parsed.success) {
          setResponse(parsed.data);
          setState('ready');
          return;
        }
        setState(
          r.status === 401
            ? 'unauthenticated'
            : r.status === 403 || r.status === 404
              ? 'forbidden'
              : 'unavailable',
        );
      })
      .catch((e) => {
        if (!(e instanceof DOMException && e.name === 'AbortError')) setState('unavailable');
      });
    return () => c.abort();
  }, [access, detail, selection.stationId, retry]);
  useEffect(() => {
    const id = response?.panel?.stationId;
    if (!id) return;
    const c = new AbortController();
    void fetch(playbackPath(id), { signal: c.signal }).then(async (r) => {
      const p = playbackResponseSchema.safeParse(await r.json().catch(() => null));
      setPlayback(r.ok && p.success ? p.data : null);
    });
    return () => c.abort();
  }, [response?.panel?.stationId]);
  const visibleLayers = {
    ...layers,
    junctions: layers.junctions && detail !== 'overview',
    sections: layers.sections && detail === 'network',
    stations: layers.stations && detail === 'network',
  };
  const select = (stationId: string, deviceId: string) => {
    returnFocus.current = `map-feature-${stationId}`;
    onSelection({ stationId, deviceId });
  };
  const traceIt = (direction: TraceResponse['direction']) => {
    if (!response?.panel) return;
    void fetch(tracePath(response.panel.stationId, direction)).then(async (r) => {
      const p = traceResponseSchema.safeParse(await r.json().catch(() => null));
      setTrace(r.ok && p.success ? p.data : null);
    });
  };
  if (state !== 'ready' || !response)
    return (
      <section className="panel" aria-live="polite">
        <h2>
          {t(
            locale,
            state === 'loading'
              ? 'mapLoading'
              : state === 'unavailable'
                ? 'mapUnavailable'
                : 'mapHeading',
          )}
        </h2>
        {state === 'unavailable' ? (
          <button className="action-button" type="button" onClick={() => setRetry((x) => x + 1)}>
            {t(locale, 'mapRetry')}
          </button>
        ) : null}
      </section>
    );
  return (
    <section className="map-network" aria-labelledby="map-heading">
      <div className="map-workspace__toolbar">
        <WorkspaceHeader
          heading={t(locale, 'mapHeading')}
          headingId="map-heading"
          locale={locale}
          provenance={
            <>
              <p>{t(locale, 'mapDetail')}</p>
              <p>
                {stripTerminalPunctuation(response.scenario.provenance)};{' '}
                <MapTime locale={locale} value={response.referenceAt} />
              </p>
            </>
          }
        >
          <fieldset className="map-mode-controls">
            <legend>{t(locale, 'mapNetwork')}</legend>
            {(['overview', 'basin', 'network'] as const).map((x) => (
              <button
                key={x}
                className="action-button"
                type="button"
                aria-pressed={detail === x}
                onClick={() => setDetail(x)}
              >
                {t(
                  locale,
                  x === 'overview' ? 'mapOverview' : x === 'basin' ? 'mapBasin' : 'mapNetwork',
                )}
              </button>
            ))}
          </fieldset>
        </WorkspaceHeader>
      </div>
      <div className="map-workspace">
        <section className="map-canvas" aria-labelledby="map-geographic-heading">
          <h3 id="map-geographic-heading" className="visually-hidden">
            {t(locale, 'mapGeographic')}
          </h3>
          <Geometry
            locale={locale}
            response={response}
            selection={selection}
            trace={trace}
            layers={visibleLayers}
            onSelect={select}
            stationCodes={stationCodes}
          />
        </section>
        <aside className="map-sidebar" aria-label={t(locale, 'mapHeading')} tabIndex={0}>
          <Panel
            locale={locale}
            response={response}
            onTrace={traceIt}
            onClose={() => onSelection({ stationId: null, deviceId: null })}
            trace={trace}
            playback={playback}
            frame={frame}
            onFrame={setFrame}
          />
          <details
            className="map-sidebar__details map-conventional-signs"
            aria-labelledby="map-conventional-signs-heading"
            open
          >
            <summary id="map-conventional-signs-heading">
              {t(locale, 'mapLayers')} — {t(locale, 'mapLegend')}
            </summary>
            <fieldset className="map-layers">
              <legend>{t(locale, 'mapLayers')}</legend>
              {(Object.keys(layers) as (keyof typeof layers)[]).map((x) => (
                <label key={x}>
                  <input
                    type="checkbox"
                    checked={layers[x]}
                    disabled={(x === 'stations' || x === 'sections') && detail !== 'network'}
                    onChange={(e) => setLayers({ ...layers, [x]: e.target.checked })}
                  />
                  {t(locale, `map${x.charAt(0).toUpperCase() + x.slice(1)}` as TranslationKey)}
                </label>
              ))}
            </fieldset>
            <StatusLegend locale={locale} heading={false} />
          </details>
          <details className="map-sidebar__details">
            <summary>{t(locale, 'mapSemanticList')}</summary>
            <ol className="map-semantic">
              {response.layers.stations.map((station) => (
                <li key={station.id}>
                  <button
                    id={`map-feature-${station.id}`}
                    type="button"
                    className="action-button"
                    aria-pressed={selection.stationId === station.id}
                    disabled={station.deviceId === null}
                    onClick={() => station.deviceId && select(station.id, station.deviceId)}
                  >
                    {t(locale, 'mapSelect')} {station.id}
                  </button>
                </li>
              ))}
            </ol>
          </details>
          <details className="map-sidebar__details">
            <summary>{t(locale, 'mapOverview')}</summary>
            <section className="map-overview" aria-labelledby="map-overview-heading">
              <h3 id="map-overview-heading" className="visually-hidden">
                {t(locale, 'mapOverview')}
              </h3>
              <ul>
                {response.overview.map((x) => (
                  <li key={x.basinId}>
                    <strong>{x.basinName}</strong>: {formatQuantityValue(locale, x.stationCount)}{' '}
                    {t(locale, 'stations')}; {t(locale, 'reported')}:{' '}
                    {formatQuantityValue(locale, x.states.reported)}; {t(locale, 'noData')}:{' '}
                    {formatQuantityValue(locale, x.states.no_data)}; {t(locale, 'statusUnreliable')}
                    : {formatQuantityValue(locale, x.states.unreliable)}
                  </li>
                ))}
              </ul>
            </section>
          </details>
          <details className="map-sidebar__details">
            <summary>{t(locale, 'mapTopology')}</summary>
            <Topology
              locale={locale}
              detail={detail}
              response={response}
              selection={selection}
              trace={trace}
            />
          </details>
        </aside>
      </div>
    </section>
  );
}
