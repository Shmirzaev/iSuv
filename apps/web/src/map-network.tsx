import { useEffect, useRef, useState } from 'react';
import {
  mapNetworkResponseSchema,
  playbackResponseSchema,
  traceResponseSchema,
  type MapNetworkResponse,
  type PlaybackResponse,
  type TraceResponse,
} from '@isuv/contracts';
import { translate, type Locale, type TranslationKey } from '@isuv/i18n';
import { formatDecimal, presentationTimestamp } from './format.js';
import { WorkspaceHeader } from './workspace-header.js';
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
  if (!value) return <>—</>;
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

function Quantity({
  locale,
  label,
  value,
}: {
  locale: Locale;
  label: TranslationKey;
  value: NonNullable<MapNetworkResponse['panel']>['stage'];
}) {
  const p = mapStatePresentation(value.state);
  return (
    <div className={`map-quantity map-quantity--${value.state}`}>
      <dt>{t(locale, label)}</dt>
      <dd>
        <span aria-hidden="true">{p.icon}</span>{' '}
        <strong>
          {`${formatQuantityValue(locale, value.value)} ${
            value.unit === 'm3/s' ? 'm³/s' : value.unit === 'm3' ? 'm³' : 'm'
          }`}
        </strong>
        <small>
          {t(locale, p.label)}: {t(locale, p.value)}
        </small>
        <small>
          {t(locale, 'mapObservedAt')}: <MapTime locale={locale} value={value.observedAt} />
        </small>
        <small>
          {t(locale, 'mapIngestedAt')}: <MapTime locale={locale} value={value.ingestedAt} />
        </small>
        <small>
          {t(locale, 'source')}: {value.source.label}; {value.source.provenance}
        </small>
      </dd>
    </div>
  );
}
type UnconfiguredValue = NonNullable<MapNetworkResponse['panel']>['targetDischarge'];
function Unconfigured({
  locale,
  label,
  value,
}: {
  locale: Locale;
  label: TranslationKey;
  value: UnconfiguredValue;
}) {
  return (
    <div className="map-unconfigured">
      <dt>{t(locale, label)}</dt>
      <dd>
        <span aria-hidden="true">⚙</span> <strong>{t(locale, 'mapUnconfigured')}</strong>
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
}: {
  locale: Locale;
  label: TranslationKey;
  icon: string;
  stateLabel: TranslationKey;
  detail: TranslationKey;
}) {
  return (
    <div>
      <dt>{t(locale, label)}</dt>
      <dd>
        <span aria-hidden="true">{icon}</span> <strong>{t(locale, stateLabel)}</strong>
        <small>{t(locale, detail)}</small>
      </dd>
    </div>
  );
}
export function StatusLegend({ locale }: { locale: Locale }) {
  return (
    <section className="map-legend" aria-labelledby="map-legend-heading">
      <h3 id="map-legend-heading">{t(locale, 'mapLegend')}</h3>
      <ul>
        {(['over', 'on_plan', 'under', 'no_data', 'unreliable'] as const).map((state) => {
          const p = mapStatePresentation(state);
          return (
            <li key={state}>
              <span aria-hidden="true">{p.icon}</span>
              <strong>{t(locale, p.label)}</strong>
              <small>{t(locale, p.value)}</small>
            </li>
          );
        })}
        <li>
          <span aria-hidden="true">!</span>
          <strong>{t(locale, 'mapDeviceFault')}</strong>
          <small>{t(locale, 'statusUnreliableValue')}</small>
        </li>
      </ul>
    </section>
  );
}
function Geometry({
  locale,
  response,
  selection,
  trace,
  layers,
  onSelect,
}: {
  locale: Locale;
  response: MapNetworkResponse;
  selection: MapSelection;
  trace: TraceResponse | null;
  layers: Record<string, boolean>;
  onSelect: (stationId: string, deviceId: string) => void;
}) {
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
  const point = ([x, y]: [number, number]) =>
    `${20 + ((x - minX) / (maxX - minX || 1)) * 560},${280 - ((y - minY) / (maxY - minY || 1)) * 240}`;
  return (
    <svg
      className="map-svg"
      viewBox="0 0 600 300"
      role="img"
      aria-label={t(locale, 'mapGeographicAria')}
    >
      <title>{t(locale, 'mapGeographicAria')}</title>
      {layers.waterways
        ? response.layers.waterways.flatMap((x) =>
            (x.geometry.type === 'LineString'
              ? [x.geometry.coordinates]
              : x.geometry.coordinates
            ).map((coordinates, component) => (
              <polyline
                key={`${x.id}-${component}`}
                className="map-waterway"
                points={coordinates.map(point).join(' ')}
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
          points={x.geometry.coordinates.map(point).join(' ')}
        />
      ))}
      {layers.junctions
        ? response.layers.junctions.map((x) => {
            const [cx, cy] = point(x.geometry.coordinates);
            return <circle key={x.id} className="map-junction" cx={cx} cy={cy} r="3" />;
          })
        : null}
      {visibleStations.map((x) => {
        const [cx, cy] = point(x.geometry.coordinates);
        const selected = selection.stationId === x.id;
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
            <title>{x.id}</title>
            <circle
              className={selected ? 'map-station map-station--selected' : 'map-station'}
              cx={cx}
              cy={cy}
              r="7"
            />
            {selected ? (
              <text x={cx} y={Number(cy) + 14}>
                {x.id}
              </text>
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
  const positions = new Map(
    junctions.map((node, index) => [
      node.id,
      [20 + (index % 25) * 32, 20 + Math.floor(index / 25) * 20] as const,
    ]),
  );
  const selectedJunction = response.layers.stations.find(
    (station) => station.id === selection.stationId,
  )?.junctionId;
  return (
    <div className="map-topology">
      <p>{t(locale, 'mapCurrentTopology')}</p>
      {detail !== 'network' ? (
        <p>{t(locale, 'mapNetwork')}</p>
      ) : (
        <>
          <svg
            className="map-topology-svg"
            viewBox="0 0 820 420"
            role="img"
            aria-label={t(locale, 'mapTopologyAria')}
          >
            <title>{t(locale, 'mapTopologyAria')}</title>
            <defs>
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
            {response.layers.sections.map((section) => {
              const from = section.upstreamJunctionId
                ? positions.get(section.upstreamJunctionId)
                : ([5, 210] as const);
              const to = section.downstreamJunctionId
                ? positions.get(section.downstreamJunctionId)
                : ([815, 210] as const);
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
                    className={
                      selected
                        ? 'map-topology-node map-topology-node--selected'
                        : traced
                          ? 'map-topology-node map-topology-node--trace'
                          : 'map-topology-node'
                    }
                    cx={at[0]}
                    cy={at[1]}
                    r="6"
                  />
                  {selected || traced ? (
                    <text x={at[0] + 7} y={at[1]}>
                      {node.id.slice(0, 8)}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
          <ol aria-label={t(locale, 'mapTrace')}>
            {trace?.edges.map((edge) => (
              <li key={edge.sectionId}>
                {edge.from ?? t(locale, 'mapBoundary')} <span aria-hidden="true">→</span>{' '}
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
                  {section.upstreamJunctionId ?? t(locale, 'mapBoundary')}{' '}
                  <span aria-hidden="true">→</span>{' '}
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
        <div className="visual-station-showcase" style={{ marginTop: '1rem' }}>
          <img
            src="/assets/network-topology-3d.jpg"
            alt="3D Digital Twin River Basin and Canal Topology"
            className="visual-station-showcase__img"
            style={{ height: '12rem' }}
            loading="lazy"
          />
          <div className="visual-station-showcase__caption">
            <span>5 Connected Basins • 83 Stations</span>
            <span className="status-chip status-chip--information">3D Digital Twin</span>
          </div>
        </div>
      </section>
    );
  const current = markerState(panel),
    p = mapStatePresentation(current),
    f = playbackFrame(playback, frame);
  return (
    <aside className="map-panel" aria-labelledby="map-panel-heading">
      <button className="action-button" type="button" onClick={onClose}>
        {t(locale, 'mapClose')}
      </button>
      <h2 id="map-panel-heading" ref={heading} tabIndex={-1}>
        {t(locale, 'mapPanel')}
      </h2>
      <p>
        <span aria-hidden="true">{p.icon}</span> <strong>{t(locale, p.label)}</strong> —{' '}
        {t(locale, p.value)}
      </p>
      <p>
        {t(locale, 'mapResponsibleTerritory')}: {panel.responsibleTerritory.name} (
        {panel.responsibleTerritory.code})
      </p>
      <dl className="map-panel__values">
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
        />
      </dl>
      <p>
        {t(locale, 'source')}: {panel.health.source.label}; {panel.health.source.provenance}
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
                {response.scenario.provenance};{' '}
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
          />
        </section>
        <aside className="map-sidebar" aria-label={t(locale, 'mapHeading')}>
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
          <details className="map-sidebar__details" open>
            <summary>{t(locale, 'mapLayers')}</summary>
            <fieldset className="map-layers">
              <legend className="visually-hidden">{t(locale, 'mapLayers')}</legend>
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
            <summary>{t(locale, 'mapLegend')}</summary>
            <StatusLegend locale={locale} />
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
