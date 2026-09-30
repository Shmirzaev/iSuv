import { useEffect, useRef, useState, type ComponentProps } from 'react';
import type { Locale } from '@isuv/i18n';
import { MapNetworkWorkspace } from './map-network.js';
import {
  filterReferenceRecords,
  regionalReferenceData,
  type ReferenceRecord,
} from './regional-reference-data.js';
import { regionalWords, type RegionalWord } from './regional-reference-i18n.js';
import { AndijanSourceMap } from './andijan-source-map.js';
import { atlasWords } from './regional-atlas-i18n.js';

const maps: { id: string; label: RegionalWord; source: string }[] = [
  { id: 'savay-area', label: 'savayMap', source: 'Savay project-area image' },
  { id: 'andijan-irrigation', label: 'andijanMap', source: 'Andijan irrigation-systems image' },
  { id: 'andijan-reference', label: 'pdfMap', source: 'Харита.pdf · 1' },
  { id: 'naryn-network', label: 'narynMap', source: 'Naryn-Karadarya network image' },
  { id: 'fergana-valley', label: 'valleyMap', source: 'Водий харитаси.jpg' },
];

function display(value: string | number | null, locale: Locale): string {
  return value === null
    ? regionalWords[locale].unknown
    : typeof value === 'number'
      ? new Intl.NumberFormat(locale === 'uz' ? 'uz-Latn' : locale, {
          maximumFractionDigits: 3,
        }).format(value)
      : value;
}

export function RegionalReferenceLink({ locale }: { locale: Locale }) {
  const w = regionalWords[locale];
  return (
    <aside className="regional-entry">
      <div>
        <strong>{w.title}</strong>
        <p>{w.summary}</p>
      </div>
      <a href="#map">{w.open} →</a>
    </aside>
  );
}

function ReferenceMap({ locale }: { locale: Locale }) {
  const w = regionalWords[locale];
  const [mapId, setMapId] = useState('savay-area');
  const [zoom, setZoom] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const viewer = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const selectedMap = maps.find((map) => map.id === mapId) ?? maps[0]!;
  useEffect(() => {
    const changed = () => setExpanded(document.fullscreenElement === viewer.current);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  return (
    <section className="regional-map" ref={viewer} aria-label={w.maps}>
      <div className="regional-map-toolbar">
        <label>
          {w.maps}
          <select
            value={mapId}
            onChange={(event) => {
              setMapId(event.target.value);
              setZoom(1);
              setFailed(false);
              frame.current?.scrollTo(0, 0);
            }}
          >
            {maps.map((map) => (
              <option key={map.id} value={map.id}>
                {w[map.label]}
              </option>
            ))}
          </select>
        </label>
        <div className="regional-zoom">
          <button
            type="button"
            aria-label={w.zoomOut}
            disabled={zoom <= 1}
            onClick={() => setZoom((value) => Math.max(1, value - 0.5))}
          >
            −
          </button>
          <output aria-live="polite">{Math.round(zoom * 100)}%</output>
          <button
            type="button"
            aria-label={w.zoomIn}
            disabled={zoom >= 5}
            onClick={() => setZoom((value) => Math.min(5, value + 0.5))}
          >
            +
          </button>
          <button
            type="button"
            onClick={() => {
              setZoom(1);
              frame.current?.scrollTo(0, 0);
            }}
          >
            {w.fit}
          </button>
          <button
            type="button"
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else void viewer.current?.requestFullscreen?.().catch(() => frame.current?.focus());
            }}
          >
            {expanded ? w.closeFull : w.full}
          </button>
        </div>
      </div>
      <div
        className="regional-map-scroll"
        ref={frame}
        tabIndex={0}
        role="region"
        aria-label={w.pan}
        onPointerDown={(event) => {
          if (event.button !== 0 || event.pointerType === 'touch') return;
          const element = event.currentTarget;
          drag.current = {
            x: event.clientX,
            y: event.clientY,
            left: element.scrollLeft,
            top: element.scrollTop,
          };
          element.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (drag.current) {
            event.currentTarget.scrollLeft = drag.current.left + drag.current.x - event.clientX;
            event.currentTarget.scrollTop = drag.current.top + drag.current.y - event.clientY;
          }
        }}
        onPointerUp={(event) => {
          drag.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
      >
        {failed ? (
          <p role="alert">
            {w.unknown} <a href={`/regional-maps/${mapId}.webp`}>{w.download}</a>
          </p>
        ) : (
          <div
            className="regional-map-image"
            style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
          >
            <img
              src={`/regional-maps/${mapId}.webp`}
              alt={w[selectedMap.label]}
              draggable={false}
              onError={() => setFailed(true)}
            />
          </div>
        )}
      </div>
      <div className="regional-map-caption">
        <span>{w.referenceOnly}</span>
        <a href={`/regional-maps/${mapId}.webp`} target="_blank" rel="noreferrer">
          {w.download}
        </a>
      </div>
      <details className="regional-provenance">
        <summary>{w.mapSource}</summary>
        <p>{selectedMap.source}</p>
        <p>{w.pan}</p>
        <p>{w.note}</p>
      </details>
    </section>
  );
}

export function ReferenceRecordDetail({
  record,
  locale,
}: {
  record: ReferenceRecord;
  locale: Locale;
}) {
  const w = regionalWords[locale];
  const source = regionalReferenceData.sources.find((item) => item.id === record.sourceId)!;
  const equipment = record.smartWater as 'present' | 'absent' | 'missing' | 'unknown';
  const quantities: [string, string | number | null][] = [
    [w.capacity, record.capacityM3s ?? record.raw.capacity],
    [w.area, record.areaHa ?? record.raw.area],
    [w.limit, record.limitM3s],
    [w.actual, record.actualM3s],
    [w.ratio, record.derivedRatioPercent],
    [w.annual, record.raw.annualVolume],
    [w.equipment, w[equipment]],
  ];
  return (
    <div className="regional-record-detail">
      <h3>{record.name ?? `${w.unnamed} ${record.raw.sequence}`}</h3>
      <p>
        {w[record.canal === 'savay' ? 'savay' : 'oqbura']} · {w.row} {record.row}
      </p>
      <dl>
        {quantities.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{display(value, locale)}</dd>
          </div>
        ))}
        <div>
          <dt>{w.date}</dt>
          <dd>{w.noDate}</dd>
        </div>
        <div>
          <dt>{w.location}</dt>
          <dd>{w.noLocation}</dd>
        </div>
      </dl>
      <p className="regional-caution">{w.annualNote}</p>
      <p>{w.limitNote}</p>
      <details open>
        <summary>{w.issues}</summary>
        <ul>
          {record.issues.map((issue) => (
            <li key={issue}>{w[issue as RegionalWord]}</li>
          ))}
        </ul>
      </details>
      <details>
        <summary>{w.raw}</summary>
        <dl>
          <div>
            <dt>{w.file}</dt>
            <dd>{source.fileName}</dd>
          </div>
          <div>
            <dt>{w.sheet}</dt>
            <dd>
              {record.sheet}!A{record.row}:I{record.row}
            </dd>
          </div>
          <div>
            <dt>{w.fingerprint}</dt>
            <dd className="regional-fingerprint">{source.sha256}</dd>
          </div>
        </dl>
        <table>
          <tbody>
            {Object.entries(record.raw).map(([key, value], index) => (
              <tr key={key}>
                <th scope="row">
                  {String.fromCharCode(65 + index)}
                  {record.row}
                </th>
                <td>{value === null ? w.unknown : String(value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {Object.entries(record.formulas).map(([cell, formula]) => (
          <p key={cell}>
            <code>
              {cell}: {formula}
            </code>
          </p>
        ))}
      </details>
    </div>
  );
}

export function RegionalReferenceWorkspace({ locale }: { locale: Locale }) {
  const w = regionalWords[locale];
  const [showRegister, setShowRegister] = useState(false);
  const [query, setQuery] = useState('');
  const [canal, setCanal] = useState('');
  const [source, setSource] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const inspector = useRef<HTMLElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const records = filterReferenceRecords(query, canal, source);
  const record = records.find((item) => item.id === selected);
  useEffect(() => {
    if (record) inspector.current?.focus();
  }, [record]);
  useEffect(() => {
    if (showRegister) searchInput.current?.focus();
  }, [showRegister]);
  return (
    <section className="regional-workspace" aria-labelledby="regional-heading">
      <div className="regional-heading">
        <div>
          <h2 id="regional-heading">{atlasWords[locale].title}</h2>
          <span className="regional-source-label">{w.supplied}</span>
        </div>
        <button
          type="button"
          aria-expanded={showRegister}
          aria-controls="regional-register"
          onClick={() => setShowRegister((value) => !value)}
        >
          {showRegister ? w.back : `${w.register} (64)`}
        </button>
      </div>
      <p className="regional-summary">{w.summary}</p>
      <div hidden={showRegister}>
        <AndijanSourceMap
          locale={locale}
          onRecords={(value) => {
            setCanal(value);
            setQuery('');
            setSource('');
            setSelected(null);
            setShowRegister(true);
          }}
        />
        <details className="atlas-source-gallery">
          <summary>{atlasWords[locale].sources}</summary>
          <ReferenceMap locale={locale} />
        </details>
      </div>
      {showRegister ? (
        <div className="regional-register" id="regional-register">
          <div className="regional-filter-bar">
            <label>
              {w.search}
              <input
                ref={searchInput}
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelected(null);
                }}
              />
            </label>
            <label>
              {w.canal}
              <select
                value={canal}
                onChange={(event) => {
                  setCanal(event.target.value);
                  setSelected(null);
                }}
              >
                <option value="">{w.all}</option>
                <option value="savay">{w.savay}</option>
                <option value="oqbura">{w.oqbura}</option>
              </select>
            </label>
            <label>
              {w.source}
              <select
                value={source}
                onChange={(event) => {
                  setSource(event.target.value);
                  setSelected(null);
                }}
              >
                <option value="">{w.all}</option>
                <option value="savay-register">{w.main}</option>
                <option value="savay-supplement">{w.supplement}</option>
              </select>
            </label>
          </div>
          <p role="status">
            {records.length} / 64 {w.rows} · {w.noDate}
          </p>
          <div className="regional-register-grid">
            <div
              className="regional-table-scroll"
              role="region"
              aria-label={w.register}
              tabIndex={0}
            >
              <table>
                <thead>
                  <tr>
                    <th scope="col">№</th>
                    <th scope="col">{w.name}</th>
                    <th scope="col">{w.canal}</th>
                    <th scope="col">{w.limit}</th>
                    <th scope="col">{w.actual}</th>
                    <th scope="col">{w.equipment}</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((item) => (
                    <tr
                      key={item.id}
                      className={selected === item.id ? 'regional-row-selected' : undefined}
                    >
                      <td>{item.raw.sequence}</td>
                      <th scope="row">
                        <button
                          type="button"
                          aria-pressed={selected === item.id}
                          onClick={() => setSelected(item.id)}
                        >
                          {item.name ?? `${w.unnamed} ${item.raw.sequence}`}
                        </button>
                        {item.sourceId === 'savay-supplement' ? (
                          <small>{w.supplement}</small>
                        ) : null}
                      </th>
                      <td>{w[item.canal === 'savay' ? 'savay' : 'oqbura']}</td>
                      <td>{display(item.limitM3s, locale)}</td>
                      <td>{display(item.actualM3s, locale)}</td>
                      <td>{w[item.smartWater as 'present' | 'absent' | 'missing' | 'unknown']}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {records.length === 0 ? <p>{w.noResults}</p> : null}
            </div>
            <aside
              ref={inspector}
              tabIndex={-1}
              aria-label={w.selected}
              className="regional-inspector"
            >
              {record ? (
                <ReferenceRecordDetail record={record} locale={locale} />
              ) : (
                <p>{w.noSelection}</p>
              )}
            </aside>
          </div>
        </div>
      ) : null}
      <p className="regional-reference-note">{w.note}</p>
      <details className="regional-provenance">
        <summary>{w.source}</summary>
        <p>{w.brief}</p>
        <p>{w.context}</p>
        {regionalReferenceData.sources.map((item) => (
          <p key={item.id}>
            {item.fileName} · {item.sheet}
            <br />
            <code className="regional-fingerprint">{item.sha256}</code>
          </p>
        ))}
      </details>
    </section>
  );
}

export function RegionalMapWorkspace(props: ComponentProps<typeof MapNetworkWorkspace>) {
  const w = regionalWords[props.locale];
  const hashMode = () =>
    typeof window !== 'undefined' && /[?&]view=demo(?:&|$)/.test(window.location.hash);
  const [demo, setDemo] = useState(() =>
    Boolean(props.selection.stationId || props.selection.deviceId || hashMode()),
  );
  useEffect(() => {
    const changed = () =>
      setDemo(Boolean(props.selection.stationId || props.selection.deviceId || hashMode()));
    changed();
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, [props.selection.stationId, props.selection.deviceId]);
  return (
    <>
      <nav className="regional-view-tabs" aria-label={w.maps}>
        <a href="#map" aria-current={!demo ? 'page' : undefined} onClick={() => setDemo(false)}>
          {w.reference}
        </a>
        <a
          href="#map?view=demo"
          aria-current={demo ? 'page' : undefined}
          onClick={() => setDemo(true)}
        >
          {w.demo}
        </a>
      </nav>
      {demo ? (
        <MapNetworkWorkspace
          {...props}
          onSelection={(selection) => {
            props.onSelection(selection);
            if (!selection.stationId && !selection.deviceId && typeof window !== 'undefined') {
              window.location.hash = '#map?view=demo';
            }
          }}
        />
      ) : (
        <RegionalReferenceWorkspace locale={props.locale} />
      )}
    </>
  );
}
