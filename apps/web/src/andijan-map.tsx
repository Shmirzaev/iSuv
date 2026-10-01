import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  andijanMapLayerLabels,
  andijanMapPointLabels,
  andijanMapWords,
  type AndijanMapLayerId,
  type AndijanMapPointId,
  type Locale,
} from '@isuv/i18n';
import { Icon } from './icons.js';
import * as MapModel from './andijan-map-model.js';
import type * as Leaflet from 'leaflet';
import type {
  AndijanFeature,
  AndijanMapData,
  AndijanMapPayload,
  AndijanStats,
  LayerDefinition,
  SearchRow,
  StatisticsTable,
} from './andijan-map-model.js';

/**
 * This module deliberately keeps Leaflet out of module scope.  The regional
 * reference workspace is rendered in non-browser tests, whereas Leaflet needs
 * `window` and a real map element.
 */
type AnyRecord = AndijanMapData;
type LayerRuntime = {
  definition: LayerDefinition;
  layer: Leaflet.GeoJSON;
  desiredOn: boolean;
  count: number;
  total: number;
};
type Runtime = {
  map: Leaflet.Map;
  L: typeof import('leaflet');
  base: Leaflet.TileLayer;
  bases: Record<string, Leaflet.TileLayer>;
  layers: Map<string, LayerRuntime>;
  overlays: Map<string, { layer: Leaflet.ImageOverlay; checked: boolean }>;
  featureLayers: Map<string, Map<AndijanFeature, Leaflet.Path>>;
  districtLayers: Map<string, Leaflet.Path>;
  districtBounds: Map<string, Leaflet.LatLngBounds>;
  allBounds: Leaflet.LatLngBounds;
  touched: boolean;
  selected: { row: SearchRow; layers: Leaflet.Path[] } | null;
  resize?: ResizeObserver;
};

// The pure model has deliberately broad GeoJSON property bags. Keep the
// imperative Leaflet boundary here rather than leaking Leaflet through it.
const model = MapModel;

function labelZoomControls(container: HTMLElement, words: typeof andijanMapWords.uz) {
  for (const [selector, label] of [
    ['.leaflet-control-zoom-in', words.zoomIn],
    ['.leaflet-control-zoom-out', words.zoomOut],
  ] as const) {
    const control = container.querySelector<HTMLElement>(selector);
    if (control) {
      control.title = label;
      control.setAttribute('aria-label', label);
    }
  }
}

function layerGroupTitle(group: string, w: typeof andijanMapWords.uz) {
  return (
    (
      {
        kmz: w.groupNetwork,
        off: w.groupOfficial,
        osm: w.groupObjects,
        zone: w.groupZones,
      } as Record<string, string>
    )[group] ?? group
  );
}

function rowsFor(data: AndijanMapPayload | null, district: string) {
  if (!data) return [];
  const source = model.districtData(data.data, data.districts, district || null);
  return model.buildSearchRows(source);
}

export default function AndijanMap({ locale }: { locale: Locale }) {
  const w = andijanMapWords[locale];
  const canvas = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const runtime = useRef<Runtime | null>(null);
  const fitIntent = useRef<'initial' | 'district' | 'all' | 'pilot'>('initial');
  const previousView = useRef<{ center: Leaflet.LatLng; zoom: number } | null>(null);
  const [data, setData] = useState<AndijanMapPayload | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [district, setDistrict] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<SearchRow | null>(null);
  const [base, setBase] = useState('osm');
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [overlays, setOverlays] = useState<Record<string, boolean>>({});
  const [opacity, setOpacity] = useState(80);
  const [multiply, setMultiply] = useState(true);
  const [mapContext, setMapContext] = useState<'pilot' | 'area'>('pilot');
  useEffect(() => {
    if (canvas.current) labelZoomControls(canvas.current, w);
  }, [locale, w]);

  const allRows = useMemo(() => rowsFor(data, district), [data, district]);
  const matches = useMemo(() => (query ? model.searchRows(allRows, query) : []), [allRows, query]);
  // Object order is the supplied selector order, including Buloqboshi before Bo'ston.
  const districts = useMemo(() => Object.keys(data?.districts ?? {}), [data]);
  const stats = useMemo(
    () =>
      data
        ? model.calculateStatistics(
            model.districtData(data.data, data.districts, district || null),
            data.stats,
            district || null,
          )
        : null,
    [data, district],
  );

  useEffect(() => {
    let active = true;
    setError(false);
    model
      .loadAndijanMapData()
      .then((loaded: AndijanMapPayload) => {
        if (active) setData(loaded);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  // Set up the map and draw vectors. Rebuilding the vector groups preserves
  // the supplied source clipping behaviour when a district changes.
  useEffect(() => {
    if (!data || !canvas.current) return;
    let cancelled = false;
    let dispose: (() => void) | undefined;
    void (async () => {
      const L = await import('leaflet');
      if (cancelled || !canvas.current) return;
      const old = runtime.current;
      if (old) {
        old.resize?.disconnect();
        old.map.remove();
      }
      const map = L.map(canvas.current, { zoomControl: true, preferCanvas: true });
      labelZoomControls(canvas.current, w);
      dispose = () => map.remove();
      const panes = model.ANDIJAN_PANES as Record<string, number>;
      Object.entries(panes).forEach(([name, zIndex]) => {
        map.createPane(name).style.zIndex = String(zIndex);
      });
      const esri = (name: string, native: number) =>
        L.tileLayer(
          `https://server.arcgisonline.com/ArcGIS/rest/services/${name}/MapServer/tile/{z}/{y}/{x}`,
          {
            maxZoom: 19,
            maxNativeZoom: native,
            attribution: 'Tiles © Esri',
          },
        );
      const bases = {
        osm: esri('World_Street_Map', 18),
        sat: esri('World_Imagery', 17),
        light: esri('Canvas/World_Light_Gray_Base', 16),
      };
      const activeBase = bases[base as keyof typeof bases] ?? bases.osm;
      activeBase.addTo(map);
      const next: Runtime = {
        map,
        L,
        base: activeBase,
        bases,
        layers: new Map(),
        overlays: new Map(),
        featureLayers: new Map(),
        districtLayers: new Map(),
        districtBounds: new Map(),
        allBounds: L.latLngBounds([]),
        touched: false,
        selected: null,
      };
      const source = model.districtData(data.data, data.districts, district || null);
      L.geoJSON(data.data.tuman ?? { type: 'FeatureCollection', features: [] }, {
        onEachFeature: (feature, layer) => {
          const districtFeature = feature as unknown as AndijanFeature;
          const districtLayer = layer as unknown as { getBounds(): Leaflet.LatLngBounds };
          if (districtFeature.properties?.name)
            next.districtBounds.set(districtFeature.properties.name, districtLayer.getBounds());
        },
      });
      const sourceRows = model.buildSearchRows(source);
      const selectFeature = (row: SearchRow, clicked?: Leaflet.Path) => {
        if (!row) return;
        setVisible((old) => ({ ...old, [row.layer.id]: true }));
        setSelected(row);
        focus(row, clicked, next);
      };
      for (const definition of model.ANDIJAN_LAYERS) {
        const fc = source[definition.key] ?? { type: 'FeatureCollection', features: [] };
        const related = new Map<AndijanFeature, Leaflet.Path>();
        const group = L.geoJSON(fc, {
          pane: definition.pane,
          style: (feature) => {
            const style = model.styleOf(definition, feature?.properties ?? {});
            return { ...style, dashArray: style.dashArray ?? undefined };
          },
          pointToLayer: (_feature, latlng) => L.circleMarker(latlng, { pane: 'pt' }),
          onEachFeature: (feature, featureLayer) => {
            const sourceFeature = feature as unknown as AndijanFeature;
            const path = featureLayer as Leaflet.Path;
            const properties = sourceFeature.properties ?? {};
            path.bindTooltip(model.tooltipHtml(definition, properties), { sticky: true });
            path.on('mouseover', () => {
              if (!next.selected?.layers.includes(path)) path.setStyle(hoverStyle(definition));
            });
            path.on('mouseout', () => {
              if (!next.selected?.layers.includes(path)) group.resetStyle(path);
            });
            path.on('click', () => {
              path.closeTooltip();
              const row =
                sourceRows.find(
                  (item) =>
                    item.layer.id === definition.id && item.features.includes(sourceFeature),
                ) ?? model.rowForFeature(definition, sourceFeature);
              selectFeature(row, path);
            });
            if (
              definition.key === 'tuman' &&
              properties.name &&
              !next.districtLayers.has(properties.name)
            )
              next.districtLayers.set(properties.name, path);
            related.set(sourceFeature, path);
          },
        });
        const count = fc.features.length;
        const total = fc.features.reduce(
          (sum: number, feature) => sum + (feature.properties.len || 0),
          0,
        );
        const desiredOn = visible[definition.id] ?? Boolean(count && !definition.off);
        next.layers.set(definition.id, { definition, layer: group, desiredOn, count, total });
        next.featureLayers.set(definition.id, related);
        if (desiredOn && count) group.addTo(map);
        if (group.getBounds().isValid()) next.allBounds.extend(group.getBounds());
      }
      Object.entries(data.overlays).forEach(([id, overlay]) => {
        const image = L.imageOverlay(overlay.file, overlay.bounds, {
          pane: 'img',
          opacity: opacity / 100,
          interactive: false,
        });
        image.on('add', () => {
          const element = image.getElement();
          if (element) element.style.mixBlendMode = multiply ? 'multiply' : 'normal';
        });
        next.overlays.set(id, { layer: image, checked: Boolean(overlays[id]) && !district });
        if (Boolean(overlays[id]) && !district) image.addTo(map);
      });
      const pilot = next.layers.get('pilot')?.layer;
      const fit = () => {
        map.invalidateSize();
        const intent = fitIntent.current;
        const bounds =
          intent === 'pilot' || intent === 'initial'
            ? pilot?.getBounds?.().isValid()
              ? pilot.getBounds()
              : next.allBounds
            : intent === 'district' && district
              ? next.districtBounds.get(district)
              : next.allBounds;
        const padding: Leaflet.PointTuple =
          intent === 'district'
            ? [40, 40]
            : intent === 'pilot'
              ? [35, 35]
              : intent === 'all'
                ? [20, 20]
                : [30, 30];
        const maxZoom =
          intent === 'district' ? 12 : intent === 'pilot' || intent === 'initial' ? 13 : undefined;
        if (bounds?.isValid()) {
          if (intent !== 'initial' && previousView.current) {
            map.setView(previousView.current.center, previousView.current.zoom, { animate: false });
            map.flyToBounds(bounds, {
              padding,
              maxZoom,
              animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
            });
            next.touched = true;
          } else map.fitBounds(bounds, { padding, maxZoom, animate: false });
        }
      };
      const touched = () => {
        next.touched = true;
      };
      map.getContainer().addEventListener('mousedown', touched, { passive: true });
      map.getContainer().addEventListener('wheel', touched, { passive: true });
      map.getContainer().addEventListener('touchstart', touched, { passive: true });
      next.resize = new ResizeObserver(() => {
        if (next.touched) map.invalidateSize();
        else fit();
      });
      next.resize.observe(canvas.current);
      fit();
      runtime.current = next;
      dispose = () => {
        previousView.current = { center: map.getCenter(), zoom: map.getZoom() };
        map.getContainer().removeEventListener('mousedown', touched);
        map.getContainer().removeEventListener('wheel', touched);
        map.getContainer().removeEventListener('touchstart', touched);
        next.resize?.disconnect();
        map.remove();
        if (runtime.current === next) runtime.current = null;
      };
    })().catch(() => {
      dispose?.();
      if (!cancelled) setError(true);
    });
    return () => {
      cancelled = true;
      dispose?.();
    };
    // Intentional rebuild: district data are already clipped by the source's
    // extraction, rather than clipped heuristically in the browser.
  }, [data, district, attempt]);

  useEffect(() => {
    const current = runtime.current;
    if (!current) return;
    const wanted = current.bases[base];
    if (wanted && wanted !== current.base) {
      current.map.removeLayer(current.base);
      wanted.addTo(current.map).bringToBack();
      current.base = wanted;
    }
  }, [base]);
  useEffect(() => {
    const current = runtime.current;
    if (!current) return;
    current.layers.forEach((record, id) => {
      const on = visible[id] ?? record.desiredOn;
      if (on && record.count) record.layer.addTo(current.map);
      else current.map.removeLayer(record.layer);
    });
  }, [visible]);
  useEffect(() => {
    const current = runtime.current;
    if (!current) return;
    current.overlays.forEach(({ layer }, id) => {
      if (overlays[id] && !district) layer.addTo(current.map);
      else current.map.removeLayer(layer);
      layer.setOpacity(opacity / 100);
      const image = layer.getElement?.();
      if (image) image.style.mixBlendMode = multiply ? 'multiply' : 'normal';
    });
  }, [overlays, opacity, multiply, district]);

  function chooseDistrict(value: string) {
    fitIntent.current = value ? 'district' : 'all';
    setMapContext('area');
    setDistrict(value);
    setSelected(null);
  }
  function choose(row: SearchRow) {
    setVisible((old) => ({ ...old, [row.layer.id]: true }));
    setSelected(row);
    if (runtime.current) focus(row, undefined, runtime.current);
  }
  function clearSelected() {
    const current = runtime.current;
    if (current?.selected) {
      const record = current.layers.get(current.selected.row.layer.id);
      current.selected.layers.forEach((layer) => record?.layer.resetStyle(layer));
      current.selected = null;
    }
    setSelected(null);
  }
  function fitArea() {
    setMapContext('area');
    const current = runtime.current;
    if (!current) return;
    const bounds = (district && current.districtBounds.get(district)) || current.allBounds;
    if (bounds?.isValid())
      current.map.flyToBounds(bounds, {
        padding: [30, 30],
        maxZoom: district ? 12 : undefined,
        animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      });
  }
  function pilotZoom() {
    fitIntent.current = 'pilot';
    setMapContext('pilot');
    setDistrict('Andijon tumani');
    setVisible((old) => ({ ...old, pilot: true }));
    setTimeout(() => {
      const current = runtime.current;
      const bounds = current?.layers.get('pilot')?.layer?.getBounds?.();
      if (current && fitIntent.current === 'pilot' && bounds?.isValid())
        current.map.flyToBounds(bounds, {
          padding: [35, 35],
          maxZoom: 13,
          animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        });
    });
  }

  if (error)
    return (
      <section
        className="andijan-map-workspace andijan-map-workspace--error"
        aria-label={w.mapAria}
      >
        <p role="alert">{w.loadError}</p>
        <button type="button" onClick={() => setAttempt((value) => value + 1)}>
          {w.retry}
        </button>
      </section>
    );
  if (!data)
    return (
      <section
        className="andijan-map-workspace andijan-map-workspace--loading"
        aria-label={w.mapAria}
      >
        <p role="status">{w.loading}</p>
      </section>
    );

  const currentData = model.districtData(data.data, data.districts, district || null);
  const groups = ['kmz', 'off', 'osm', 'zone'];
  return (
    <section className="andijan-map-workspace" aria-label={w.mapAria}>
      <aside className="andijan-map-sidebar">
        <header className="andijan-map-sidebar__header">
          <h1>{w.title}</h1>
          <p>{w.detail}</p>
          <p className="andijan-map-stamp">{w.confidentiality}</p>
          <p className="andijan-map-reference">{w.referenceNotice}</p>
        </header>
        <section className="andijan-map-sidebar__section andijan-map-controls">
          <label htmlFor="andijan-district">{w.district}</label>
          <select
            id="andijan-district"
            value={district}
            onChange={(event) => chooseDistrict(event.target.value)}
          >
            <option value="">{w.allDistricts}</option>
            {districts.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <div className="andijan-map-overview" hidden={!district || !stats?.rows?.[0]}>
            {stats?.rows?.[0] && (
              <>
                <span>
                  <span>{w.statsCanals}</span>
                  <b>
                    {stats.rows[0].canals_cnt} ·{' '}
                    {Number(stats.rows[0].canals_km ?? 0).toLocaleString('uz', {
                      maximumFractionDigits: 1,
                    })}{' '}
                    km
                  </b>
                </span>
                <span>
                  <span>{w.statsCollectors}</span>
                  <b>
                    {Number(stats.rows[0].col_km ?? 0).toLocaleString('uz', {
                      maximumFractionDigits: 1,
                    })}{' '}
                    km
                  </b>
                </span>
                <span>
                  <span>{w.statsWells}</span>
                  <b>{stats.rows[0].wells_cnt}</b>
                </span>
              </>
            )}
          </div>
          <label htmlFor="andijan-search">{w.search}</label>
          <div className="andijan-map-search">
            <input
              ref={searchInput}
              id="andijan-search"
              value={query}
              placeholder={w.searchPlaceholder}
              autoComplete="off"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setQuery('');
                  (event.currentTarget as HTMLInputElement).blur();
                }
                if (event.key === 'Enter' && matches[0]) {
                  event.preventDefault();
                  choose(matches[0]);
                }
              }}
            />
            {query && (
              <button
                type="button"
                aria-label={w.clearSearch}
                title={w.clearSearch}
                onClick={() => {
                  setQuery('');
                  searchInput.current?.focus();
                }}
              >
                <Icon name="clear" />
              </button>
            )}
          </div>
          <p className="andijan-map-search-status" aria-live="polite">
            {query
              ? `${matches.length} ${w.searchResults}`
              : w.searchIdle.replace('{count}', String(allRows.length))}
          </p>
          {query && (
            <div className="andijan-map-results">
              {matches.slice(0, 40).map((row) => (
                <button
                  type="button"
                  key={row.id}
                  className={selected?.id === row.id ? 'is-selected' : ''}
                  onClick={() => choose(row)}
                >
                  <span>
                    <b>{row.name}</b>
                    <small>
                      {[
                        row.kind,
                        row.district,
                        row.parts > 1 ? `${row.parts} ${w.featureParts}` : '',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </small>
                  </span>
                  <output>{row.size}</output>
                </button>
              ))}
              {!matches.length && <p>{w.searchEmpty}</p>}
              {matches.length > 40 && (
                <p>{w.searchMore.replace('{count}', String(matches.length - 40))}</p>
              )}
            </div>
          )}
          {selected && (
            <section className="andijan-map-selected" aria-label={w.selectedObject}>
              <div>
                <strong>{selected.name}</strong>
                <button type="button" aria-label={w.closeSelected} onClick={clearSelected}>
                  <Icon name="close" />
                </button>
              </div>
              <dl>
                <div>
                  <dt>{w.featureType}</dt>
                  <dd>{selected.kind}</dd>
                </div>
                {selected.district && (
                  <div>
                    <dt>{w.tooltipDistrict}</dt>
                    <dd>{selected.district}</dd>
                  </div>
                )}
                {selected.size && (
                  <div>
                    <dt>{selected.length > 0 ? w.tooltipLength : w.tooltipArea}</dt>
                    <dd>{selected.size}</dd>
                  </div>
                )}
              </dl>
              {selected.layer.id === 'pilot' && <p>{w.selectedPilotDetail}</p>}
              <p>
                {w.referenceOnly}. {w.noLiveReadings}.
              </p>
              <button type="button" onClick={() => choose(selected)}>
                {w.showOnMap}
              </button>
            </section>
          )}
        </section>
        <section
          className="andijan-map-sidebar__section andijan-map-pilot"
          aria-label={w.pilotHeading}
        >
          <h2>{w.pilotHeading}</h2>
          <p>{w.pilotDetail}</p>
          <p>{w.pilotFacts}</p>
          <div>
            <button type="button" onClick={pilotZoom}>
              {w.pilotGo}
            </button>
            <LayerToggle
              definition={model.ANDIJAN_LAYERS.find((item) => item.id === 'pilot')}
              data={currentData}
              visible={visible}
              setVisible={setVisible}
              labelOverride={w.pilotCheckbox}
              locale={locale}
            />
          </div>
          <p>{w.pilotNote}</p>
        </section>
        {groups.map((group) => (
          <details
            className="andijan-map-sidebar__section andijan-map-layers"
            key={group}
            open={group === 'kmz'}
          >
            <summary>
              {layerGroupTitle(group, w)} <span>{groupCount(group, currentData, w)}</span>
            </summary>
            {group === 'osm' && (
              <button
                type="button"
                className="andijan-map-group-toggle"
                onClick={() => toggleGroup(group, currentData, visible, setVisible)}
              >
                {w.groupToggle}
              </button>
            )}
            {model.ANDIJAN_LAYERS.filter((item) => item.g === group).map((definition) => (
              <LayerToggle
                key={definition.id}
                definition={definition}
                data={currentData}
                visible={visible}
                setVisible={setVisible}
                locale={locale}
              />
            ))}
            <p className="andijan-map-group-note">
              {group === 'kmz'
                ? w.networkNote
                : group === 'off'
                  ? w.officialNote
                  : group === 'osm'
                    ? w.objectsNote
                    : null}
            </p>
            {group === 'osm' && <PointLegend locale={locale} />}
          </details>
        ))}
        <details className="andijan-map-sidebar__section andijan-map-overlays">
          <summary>{w.groupScans}</summary>
          {Object.entries(data.overlays ?? {}).map(([id, item]) => (
            <label key={id}>
              <input
                type="checkbox"
                disabled={Boolean(district)}
                checked={Boolean(overlays[id])}
                onChange={(event) => setOverlays((old) => ({ ...old, [id]: event.target.checked }))}
              />
              {item.title}
              <small>{item.conf}</small>
              <small>{item.note}</small>
            </label>
          ))}
          <label>
            {w.opacity}
            <input
              type="range"
              min="15"
              max="100"
              value={opacity}
              onChange={(event) => setOpacity(Number(event.target.value))}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={multiply}
              onChange={(event) => setMultiply(event.target.checked)}
            />
            {w.multiply}
          </label>
          <p>{w.scannedNote}</p>
        </details>
        <details className="andijan-map-sidebar__section andijan-map-stats">
          <summary>{w.groupStatistics}</summary>
          <Stats stats={stats} sourceStats={data.stats} w={w} district={district} />
        </details>
        <section className="andijan-map-sidebar__section andijan-map-basemap">
          <h2>{w.groupBaseMap}</h2>
          <div role="group" aria-label={w.groupBaseMap}>
            {(
              [
                ['osm', w.street],
                ['sat', w.satellite],
                ['light', w.light],
              ] as const
            ).map(([id, label]) => (
              <button
                type="button"
                key={id}
                aria-pressed={base === id}
                className={base === id ? 'is-selected' : ''}
                onClick={() => setBase(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </section>
      </aside>
      <div className="andijan-map-canvas-wrap">
        <div id="andijan-map-canvas" ref={canvas} role="region" aria-label={w.mapAria} />
        <div className="andijan-map-tools" aria-label={w.mapControls}>
          <span>{mapContext === 'pilot' ? w.pilotContext : district || w.mapContextAll}</span>
          <button type="button" title={w.returnToArea} onClick={fitArea}>
            <Icon name="fit_area" />
            {w.returnToArea}
          </button>
        </div>
      </div>
    </section>
  );
}

function LayerToggle({
  definition,
  data,
  visible,
  setVisible,
  labelOverride,
  locale,
}: {
  definition: LayerDefinition | undefined;
  data: AndijanMapData;
  visible: Record<string, boolean>;
  setVisible: Dispatch<SetStateAction<Record<string, boolean>>>;
  labelOverride?: string;
  locale: Locale;
}) {
  if (!definition) return null;
  const fc = data?.[definition.key] ?? { features: [] };
  const count = fc.features.length;
  const on = visible[definition.id] ?? Boolean(count && !definition.off);
  const countText = andijanMapWords[locale].featureCount.replace('{count}', String(count));
  const stat =
    definition.type === 'line'
      ? `${countText} · ${model.formatKilometres(fc.features.reduce((sum, item) => sum + (item.properties.len || 0), 0))}`
      : countText;
  const pointColour =
    definition.type === 'pt' ? model.ANDIJAN_POINT_TYPES.well[1] : (definition.color ?? '#e11d48');
  return (
    <label className="andijan-map-layer">
      <input
        type="checkbox"
        disabled={!count}
        checked={on}
        onChange={(event) =>
          setVisible((old) => ({ ...old, [definition.id]: event.target.checked }))
        }
      />
      <svg
        className={`andijan-map-swatch andijan-map-swatch--${definition.type}`}
        viewBox="0 0 24 14"
        aria-hidden="true"
        focusable="false"
      >
        {definition.type === 'pt' ? (
          <circle cx="12" cy="7" r="4" fill={pointColour} stroke="#fff" strokeWidth="1.5" />
        ) : definition.type === 'poly' ? (
          <rect
            x="2"
            y="2"
            width="20"
            height="10"
            fill={definition.fill ?? definition.color}
            fillOpacity={definition.fillOpacity ?? 0.4}
            stroke={definition.color}
            strokeWidth={definition.w ?? 1.2}
            strokeDasharray={definition.dash}
          />
        ) : (
          <line
            x1="1"
            x2="23"
            y1="7"
            y2="7"
            stroke={definition.color}
            strokeWidth={definition.w ?? 2}
            strokeDasharray={definition.dash}
          />
        )}
      </svg>
      <span>
        {labelOverride ??
          andijanMapLayerLabels[locale as Locale][definition.id as AndijanMapLayerId]}
      </span>
      <small>{stat}</small>
    </label>
  );
}

function PointLegend({ locale }: { locale: Locale }) {
  return (
    <ul className="andijan-map-point-legend">
      {Object.entries(
        model.ANDIJAN_POINT_TYPES as Record<AndijanMapPointId, readonly [string, string]>,
      ).map(([id, [, color]]) => (
        <li key={id}>
          <i style={{ backgroundColor: color }} />
          {andijanMapPointLabels[locale][id as AndijanMapPointId]}
        </li>
      ))}
    </ul>
  );
}

function groupCount(group: string, data: AnyRecord, w: typeof andijanMapWords.uz) {
  const active = model.ANDIJAN_LAYERS.filter(
    (item) => item.g === group && (data?.[item.key]?.features.length ?? 0),
  );
  return active.length ? `${active.length} ${w.layersCount}` : w.noData;
}

function toggleGroup(
  group: string,
  data: AnyRecord,
  visible: Record<string, boolean>,
  setVisible: Dispatch<SetStateAction<Record<string, boolean>>>,
) {
  const ids = model.ANDIJAN_LAYERS.filter(
    (item) => item.g === group && data?.[item.key]?.features.length,
  ).map((item) => item.id);
  const anyOn = ids.some((id) => visible[id] !== false);
  setVisible((old: Record<string, boolean>) => ({
    ...old,
    ...Object.fromEntries(ids.map((id) => [id, !anyOn])),
  }));
}

function Stats({
  stats,
  sourceStats,
  w,
  district,
}: {
  stats: StatisticsTable | null;
  sourceStats: AndijanStats;
  w: typeof andijanMapWords.uz;
  district: string;
}) {
  if (!stats?.rows?.length) return null;
  const total = stats.totals;
  const rawRows = Array.isArray(sourceStats?.rows) ? sourceStats.rows : [];
  const value = (number: unknown) =>
    typeof number === 'number' ? number.toLocaleString('uz', { maximumFractionDigits: 1 }) : '';
  return (
    <>
      <h2>{district ? `${district} ${w.statsDistrictTitle}` : w.statsAllTitle}</h2>
      <table>
        <thead>
          <tr>
            <th>{w.district}</th>
            <th>{w.statsCanals}</th>
            <th>{w.statsCollectors}</th>
            <th>{w.statsWells}</th>
          </tr>
        </thead>
        <tbody>
          {stats.rows.map((row) => (
            <tr key={row.district}>
              <td>{row.district}</td>
              <td>
                {value(row.canals_km)} <small>({row.canals_cnt})</small>
              </td>
              <td>
                {value(row.col_km)} <small>({row.col_cnt})</small>
              </td>
              <td>{row.wells_cnt}</td>
            </tr>
          ))}
          {!district && (
            <tr>
              <td>{w.statsTotal}</td>
              <td>{value(total.canalsKm)} km</td>
              <td>{value(total.collectorKm)} km</td>
              <td>{total.wells}</td>
            </tr>
          )}
        </tbody>
      </table>
      <p>{district ? w.statsDistrictNote : w.statsAllNote}</p>
      {!district && rawRows.length > 0 && (
        <>
          <h2>{w.itbTitle}</h2>
          <table>
            <thead>
              <tr>
                <th>{w.statsMeasure}</th>
                <th>{w.statsUnit}</th>
                <th>Andijonsoy</th>
                <th>Qoradaryo-Mayliysoy</th>
                <th>Savay-Oqbura</th>
                <th>Shahrixonsoy</th>
                <th>Ulug'nor-Mazgilsoy</th>
                <th>{w.statsOther}</th>
                <th>{w.statsTotal}</th>
              </tr>
            </thead>
            <tbody>
              {rawRows.map((row, rowIndex) => {
                const [name, unit, values, other, sum] = row;
                return (
                  <tr key={`${rowIndex}:${name}`}>
                    <td>{name}</td>
                    <td>{unit}</td>
                    {values.map((item: number, index: number) => (
                      <td key={index}>{value(item)}</td>
                    ))}
                    <td>{Array.isArray(other) ? `${value(other[1])} (${other[0]})` : ''}</td>
                    <td>{value(sum)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p>{w.itbSourceNote}</p>
        </>
      )}
    </>
  );
}

function focus(row: SearchRow, clicked: Leaflet.Path | undefined, runtime: Runtime) {
  const record = runtime.layers.get(row.layer.id);
  const featureLayers = runtime.featureLayers.get(row.layer.id);
  const allLayers = row.features
    .map((feature) => featureLayers?.get(feature))
    .filter((layer): layer is Leaflet.Path => Boolean(layer));
  const layers = clicked ? [clicked] : allLayers;
  if (!record || !layers.length) return;
  if (runtime.selected) {
    const prior = runtime.layers.get(runtime.selected.row.layer.id);
    runtime.selected.layers.forEach((layer) => prior?.layer.resetStyle(layer));
  }
  record.layer.addTo(runtime.map);
  allLayers.forEach((layer) => {
    const style =
      record.definition.type === 'pt'
        ? { radius: 9, color: '#f59e0b', weight: 3, fillColor: '#fbbf24' }
        : {
            color: '#f59e0b',
            weight: record.definition.type === 'line' ? 6 : 3,
            opacity: 1,
            fillColor: '#fbbf24',
            fillOpacity: 0.6,
          };
    layer.setStyle?.(style);
    layer.bringToFront?.();
  });
  runtime.selected = { row, layers: allLayers };
  runtime.touched = true;
  runtime.map.invalidateSize();
  runtime.map.stop();
  const animate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const options = { animate, duration: 1.05 };
  const layerCenter = (layer: Leaflet.Path): Leaflet.LatLng => {
    if (layer instanceof runtime.L.CircleMarker) return layer.getLatLng();
    if (layer instanceof runtime.L.Polyline) return layer.getCenter();
    return runtime.L.featureGroup([layer]).getBounds().getCenter();
  };
  const nearest = layers.reduce((best, layer) =>
    runtime.map.distance(runtime.map.getCenter(), layerCenter(layer)) <
    runtime.map.distance(runtime.map.getCenter(), layerCenter(best))
      ? layer
      : best,
  );
  if (record.definition.type === 'pt') runtime.map.flyTo(layerCenter(nearest), 16, options);
  else {
    const bounds = runtime.L.featureGroup(layers).getBounds();
    if (!bounds.isValid()) return;
    if (
      record.definition.type === 'line' &&
      runtime.map.getBoundsZoom(bounds, false, runtime.L.point(32, 32)) < 12
    )
      runtime.map.flyTo(layerCenter(nearest), 12, options);
    else runtime.map.flyToBounds(bounds, { ...options, padding: [32, 32], maxZoom: 16 });
  }
}

function hoverStyle(definition: LayerDefinition) {
  if (definition.type === 'line') return { weight: (definition.w ?? 1) + 3, opacity: 1 };
  if (definition.type === 'pt') return { radius: 8 };
  return { weight: Math.max(definition.w ?? 1.2, 3) + 1, fillOpacity: 0.75 };
}
