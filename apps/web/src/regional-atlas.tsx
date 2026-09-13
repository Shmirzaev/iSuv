import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Locale } from '@isuv/i18n';
import {
  andijanScene,
  savayScene,
  viewForArea,
  displayWaterwayPath,
  type AtlasArea,
  type AtlasWaterway,
} from './regional-atlas-model.js';
import { atlasWords } from './regional-atlas-i18n.js';
import { regionalReferenceData } from './regional-reference-data.js';
import { atlasDetail, visibleLandmarks, type AtlasLandmark } from './regional-atlas-detail.js';

type Camera = [number, number, number, number];
export function RegionalAtlas({
  locale,
  onRecords,
}: {
  locale: Locale;
  onRecords: (canal: 'savay' | 'oqbura') => void;
}) {
  const w = atlasWords[locale];
  const [detail, setDetail] = useState(false);
  const [areaId, setAreaId] = useState<string | null>(null);
  const [waterwayId, setWaterwayId] = useState<string | null>(null);
  const [landmarkId, setLandmarkId] = useState<string | null>(null);
  const [towns, setTowns] = useState(true);
  const [roads, setRoads] = useState(true);
  const [pumps, setPumps] = useState(true);
  const [points, setPoints] = useState(true);
  const [camera, setCamera] = useState<Camera>([0, 0, 1280, 870]);
  const [original, setOriginal] = useState(false);
  const [labels, setLabels] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const container = useRef<HTMLElement>(null);
  const selectedPanel = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; y: number; camera: Camera; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const scene = detail ? savayScene : andijanScene;
  const decoration = atlasDetail[scene.id];
  const landmark = decoration.landmarks.find((item) => item.id === landmarkId);
  const closeView = camera[2] < 850;
  const landmarks = visibleLandmarks(scene.id, closeView, towns, pumps, points);
  const area = scene.areas.find((item) => item.id === areaId);
  const waterway = scene.waterways.find((item) => item.id === waterwayId);
  const visibleWaterways = area
    ? scene.waterways.filter((item) => item.areas.includes(area.id))
    : scene.waterways;

  useEffect(() => {
    const changed = () => setExpanded(document.fullscreenElement === container.current);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  useEffect(() => {
    if (waterwayId || landmarkId) selectedPanel.current?.focus({ preventScroll: true });
  }, [waterwayId, landmarkId]);
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const transform = element.getScreenCTM();
      if (!transform) return;
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(transform.inverse());
      setCamera(([x, y, width, height]) => {
        const next = Math.max(160, Math.min(1600, width * (event.deltaY > 0 ? 1.12 : 0.89)));
        const factor = next / width;
        return [
          point.x - (point.x - x) * factor,
          point.y - (point.y - y) * factor,
          next,
          height * factor,
        ];
      });
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);

  function reset() {
    setCamera(area ? viewForArea(area) : [0, 0, scene.width, scene.height]);
  }
  function root() {
    setLandmarkId(null);
    svg.current?.focus({ preventScroll: true });
    setDetail(false);
    setAreaId(null);
    setWaterwayId(null);
    setCamera([0, 0, 1280, 870]);
  }
  function savay() {
    setLandmarkId(null);
    svg.current?.focus({ preventScroll: true });
    setDetail(true);
    setAreaId(null);
    setWaterwayId(null);
    setCamera([100, 15, 1120, 825]);
  }
  function selectArea(item: AtlasArea) {
    setLandmarkId(null);
    if (item.id === 'savay-area') {
      savay();
      return;
    }
    setAreaId(item.id);
    setWaterwayId(null);
    setCamera(viewForArea(item));
  }
  function selectWaterway(item: AtlasWaterway) {
    setLandmarkId(null);
    setWaterwayId(item.id);
  }
  function selectLandmark(item: AtlasLandmark) {
    setAreaId(null);
    setWaterwayId(null);
    setLandmarkId(item.id);
    if (item.kind === 'settlement') setTowns(true);
    if (item.kind === 'pump') setPumps(true);
    if (item.kind === 'point') setPoints(true);
    setCamera([item.at[0] - 260, item.at[1] - 185, 520, 370]);
  }
  function zoom(factor: number) {
    setCamera(([x, y, width, height]) => {
      const next = Math.max(160, Math.min(1600, width * factor));
      const nextHeight = (height * next) / width;
      return [x + (width - next) / 2, y + (height - nextHeight) / 2, next, nextHeight];
    });
  }
  function featureKey(event: React.KeyboardEvent, action: () => void) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      action();
    }
  }
  return (
    <section className="regional-atlas" ref={container} aria-label={w.map}>
      <div className="atlas-topbar">
        <nav aria-label={w.navigation} className="atlas-breadcrumbs">
          <button onClick={root} aria-current={!detail && !area ? 'location' : undefined}>
            {w.andijan}
          </button>
          {detail && (
            <>
              <span aria-hidden="true">/</span>
              <button onClick={savay} aria-current={!area ? 'location' : undefined}>
                Savay · Oqbura-soy
              </button>
            </>
          )}
          {area && (
            <>
              <span aria-hidden="true">/</span>
              <span aria-current="location">{area.name}</span>
            </>
          )}
        </nav>
        <div className="atlas-options">
          <select
            className="atlas-place-search"
            aria-label={w.findPlace}
            value=""
            onChange={(e) => {
              const item = decoration.landmarks.find((entry) => entry.id === e.target.value);
              if (item) selectLandmark(item);
            }}
          >
            <option value="">⌕ {w.findPlace}</option>
            {(['settlement', 'pump', 'point'] as const).map((kind) => (
              <optgroup
                key={kind}
                label={kind === 'settlement' ? w.towns : kind === 'pump' ? w.pumps : w.points}
              >
                {decoration.landmarks
                  .filter((item) => item.kind === kind)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.kind === 'point' ? `${w.point} ${item.name}` : item.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          <details className="atlas-layer-menu">
            <summary>▱ {w.layers}</summary>
            <div>
              <label>
                <input
                  type="checkbox"
                  checked={towns}
                  onChange={(e) => setTowns(e.target.checked)}
                />
                {w.towns}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={roads}
                  onChange={(e) => setRoads(e.target.checked)}
                />
                {w.roads}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={pumps}
                  onChange={(e) => setPumps(e.target.checked)}
                />
                {w.pumps}
              </label>
              {detail && (
                <label>
                  <input
                    type="checkbox"
                    checked={points}
                    onChange={(e) => setPoints(e.target.checked)}
                  />
                  {w.points}
                </label>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={labels}
                  onChange={(e) => setLabels(e.target.checked)}
                />
                {w.labels}
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={original}
                  onChange={(e) => setOriginal(e.target.checked)}
                />
                {w.original}
              </label>
            </div>
          </details>
          <button
            aria-label={expanded ? w.exit : w.full}
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else void container.current?.requestFullscreen?.().catch(() => svg.current?.focus());
            }}
          >
            ⛶
          </button>
        </div>
      </div>
      <div className="atlas-canvas">
        <svg
          ref={svg}
          viewBox={camera.join(' ')}
          tabIndex={0}
          role="group"
          aria-label={w.map}
          aria-describedby="atlas-controls"
          data-scene={scene.id}
          style={
            {
              '--atlas-label-scale': Math.max(0.3, Math.min(1.28, camera[2] / 1000)),
            } as CSSProperties
          }
          onKeyDown={(e) => {
            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
              e.preventDefault();
              setCamera(([x, y, width, height]) => [
                x + ((e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0) * width) / 10,
                y + ((e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0) * height) / 10,
                width,
                height,
              ]);
            } else if (e.key === '+' || e.key === '=') {
              e.preventDefault();
              zoom(0.8);
            } else if (e.key === '-') {
              e.preventDefault();
              zoom(1.25);
            } else if (e.key === 'Escape') {
              setLandmarkId(null);
              setWaterwayId(null);
              reset();
            }
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            suppressClick.current = false;
            drag.current = { x: e.clientX, y: e.clientY, camera, moved: false };
          }}
          onPointerMove={(e) => {
            const start = drag.current;
            if (!start) return;
            if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < 5 && !start.moved) return;
            start.moved = true;
            suppressClick.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            const box = e.currentTarget.getBoundingClientRect();
            const scale = Math.max(start.camera[2] / box.width, start.camera[3] / box.height);
            setCamera([
              start.camera[0] - (e.clientX - start.x) * scale,
              start.camera[1] - (e.clientY - start.y) * scale,
              start.camera[2],
              start.camera[3],
            ]);
          }}
          onPointerUp={(e) => {
            drag.current = null;
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onLostPointerCapture={() => {
            drag.current = null;
          }}
        >
          <title>{`${w.map} — ${scene.name}`}</title>
          <defs>
            <linearGradient id="atlas-lake" x2="0.7" y2="1">
              <stop stopColor="#8bd2df" />
              <stop offset="1" stopColor="#2595bb" />
            </linearGradient>
            <pattern id="atlas-grid" width="80" height="80" patternUnits="userSpaceOnUse">
              <path d="M80 0H0V80" fill="none" stroke="#a7b7a2" strokeWidth="0.6" opacity="0.25" />
            </pattern>
          </defs>
          <rect x="-5000" y="-5000" width="10000" height="10000" fill="#edf0e5" />
          <image
            href={
              original ? `/regional-maps/${scene.source}.webp` : '/regional-maps/atlas-terrain.png'
            }
            width={scene.width}
            height={scene.height}
            preserveAspectRatio="none"
            opacity={original ? 0.8 : 0.42}
          />
          {!original && <rect width={scene.width} height={scene.height} fill="url(#atlas-grid)" />}
          {scene.areas.map((item) => (
            <g
              key={item.id}
              role="button"
              tabIndex={0}
              aria-label={item.name}
              aria-pressed={item.id === areaId}
              className={`atlas-area ${item.id === areaId ? 'is-selected' : ''}`}
              onClick={() => {
                if (!suppressClick.current) selectArea(item);
              }}
              onKeyDown={(e) => featureKey(e, () => selectArea(item))}
            >
              <path
                d={item.path}
                fill={item.color}
                fillOpacity={original ? 0.12 : areaId && item.id !== areaId ? 0.18 : 0.38}
                stroke="#607b6b"
                strokeWidth="1.1"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          ))}
          <g pointerEvents="none" className="atlas-geographic-context">
            {roads &&
              decoration.roads.map((path, index) => (
                <g key={index} className="atlas-road">
                  <path d={path} className="atlas-road-casing" />
                  <path d={path} className="atlas-road-line" />
                </g>
              ))}
            {decoration.lakes.map((lake) => (
              <g key={lake.name} className="atlas-lake">
                <path d={lake.path} fill="url(#atlas-lake)" stroke="#378eae" strokeWidth="1.2" />
                <text x={lake.label[0]} y={lake.label[1]} textAnchor="middle">
                  {lake.name}
                </text>
              </g>
            ))}
            <text
              x={detail ? 1085 : 1035}
              y={detail ? 495 : 359}
              className="atlas-country"
              textAnchor="middle"
            >
              {w.kyrgyzstan}
            </text>
          </g>
          {scene.waterways.map((item) => (
            <g
              key={item.id}
              role={detail || area ? 'button' : undefined}
              tabIndex={detail || area ? 0 : undefined}
              aria-label={item.name}
              aria-pressed={detail || area ? item.id === waterwayId : undefined}
              className={`atlas-waterway ${item.minor ? 'is-minor' : ''} ${item.id === waterwayId ? 'is-selected' : ''}`}
              pointerEvents={detail || area ? undefined : 'none'}
              opacity={area && !item.areas.includes(area.id) ? 0.35 : 1}
              onClick={() => {
                if (!suppressClick.current) selectWaterway(item);
              }}
              onKeyDown={(e) => featureKey(e, () => selectWaterway(item))}
            >
              <path
                className="atlas-river-halo"
                d={displayWaterwayPath(item.path)}
                fill="none"
                stroke="#ffffff"
                strokeWidth="6"
                vectorEffect="non-scaling-stroke"
              />
              <path
                className="atlas-river-line"
                d={displayWaterwayPath(item.path)}
                fill="none"
                stroke="#087da4"
                strokeWidth="2.5"
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={displayWaterwayPath(item.path)}
                fill="none"
                stroke="transparent"
                strokeWidth="22"
                vectorEffect="non-scaling-stroke"
              />
              {labels && (!item.minor || closeView || area) && (
                <text x={item.label[0]} y={item.label[1]} className="atlas-river-label">
                  {item.name}
                </text>
              )}
            </g>
          ))}
          {landmarks.map((item) => (
            <g
              key={item.id}
              className={`atlas-landmark atlas-${item.kind} ${landmarkId === item.id ? 'is-selected' : ''}`}
              transform={`translate(${item.at.join(' ')})`}
              role="button"
              tabIndex={0}
              aria-label={
                item.kind === 'point'
                  ? `${w.point} ${item.name}`
                  : item.kind === 'pump'
                    ? `${w.pumps}: ${item.name}`
                    : item.name
              }
              aria-pressed={landmarkId === item.id}
              onClick={() => {
                if (!suppressClick.current) selectLandmark(item);
              }}
              onKeyDown={(e) => featureKey(e, () => selectLandmark(item))}
            >
              <circle r={item.kind === 'settlement' ? 13 : 17} fill="transparent" />
              {item.kind === 'pump' ? (
                <>
                  <rect x="-8" y="-8" width="16" height="16" rx="4" />
                  <path
                    d="M-3 4 V-4 H1 Q6 -4 5 0 Q4 2 -3 1"
                    fill="none"
                    stroke="white"
                    strokeWidth="1.6"
                  />
                </>
              ) : item.kind === 'point' ? (
                <>
                  <rect x="-8" y="-8" width="16" height="16" rx="3" />
                  <text textAnchor="middle" y="3.5" className="atlas-point-number">
                    {item.name}
                  </text>
                </>
              ) : (
                <>
                  <circle r={item.major ? 4 : 2.8} className="atlas-town-ring" />
                  <circle r="1.5" fill="#4d625b" />
                </>
              )}
              {item.kind !== 'point' && (
                <text x="12" y={item.kind === 'pump' ? 23 : 4} className="atlas-place-label">
                  {item.name}
                </text>
              )}
            </g>
          ))}
          {scene.areas.map((item) => (
            <text
              key={`label-${item.id}`}
              x={item.label[0]}
              y={item.label[1]}
              textAnchor="middle"
              className="atlas-area-label"
              aria-hidden="true"
            >
              {item.name}
            </text>
          ))}
        </svg>
        <div className="atlas-map-hint" role="status">
          {detail || area ? w.detailHint : w.hint}
        </div>
        <div className="atlas-compass" aria-hidden="true">
          {w.north}
          <br />↑
        </div>
        <div className="atlas-zoom">
          <button aria-label={w.zoomIn} onClick={() => zoom(0.8)}>
            +
          </button>
          <button aria-label={w.zoomOut} onClick={() => zoom(1.25)}>
            −
          </button>
          <button aria-label={w.reset} onClick={reset}>
            ↺
          </button>
          {(detail || area) && (
            <button
              aria-label={w.back}
              onClick={() => {
                if (detail && area) savay();
                else root();
              }}
            >
              ←
            </button>
          )}
        </div>
        {(waterway || landmark) && (
          <aside
            className="atlas-waterway-card"
            ref={selectedPanel}
            tabIndex={-1}
            aria-label={waterway ? w.selected : w.landmark}
          >
            <button
              className="atlas-card-close"
              aria-label={w.close}
              onClick={() => {
                setWaterwayId(null);
                setLandmarkId(null);
                svg.current?.focus();
              }}
            >
              ×
            </button>
            <span>
              {waterway
                ? w.selected
                : landmark?.kind === 'pump'
                  ? w.pumps
                  : landmark?.kind === 'point'
                    ? w.point
                    : w.towns}
            </span>
            <h3>{waterway?.name ?? landmark?.name}</h3>
            {landmark ? (
              <>
                <p>
                  {w.originalLabel}: <strong>{landmark.sourceLabel}</strong>
                </p>
                <p>{landmark.kind === 'point' ? w.pointNote : w.landmarkNote}</p>
                <small>{decoration.source}.webp</small>
              </>
            ) : waterway?.register ? (
              <>
                <p>
                  <strong>
                    {
                      regionalReferenceData.records.filter(
                        (item) => item.canal === waterway.register,
                      ).length
                    }
                  </strong>{' '}
                  {w.registerCount}
                </p>
                <button
                  onClick={() => {
                    const open = () => onRecords(waterway.register!);
                    if (document.fullscreenElement === container.current)
                      void document.exitFullscreen().then(open, open);
                    else open();
                  }}
                >
                  {w.records} →
                </button>
                <p>{w.unlocated}</p>
              </>
            ) : (
              <p>{w.noRecords}</p>
            )}
          </aside>
        )}
        <div className="atlas-reference-badge">
          <div className="atlas-map-legend">
            <span>≈ {w.waterways}</span>
            <span>○ {w.towns}</span>
            {detail ? <span>▣ {w.pumps}</span> : <span>▰ {w.reservoirs}</span>}
          </div>
          {w.reference}
        </div>
      </div>
      <div className="atlas-feature-bar" aria-label={w.features}>
        <div>
          <span>{w.areas}</span>
          {scene.areas.map((item) => (
            <button
              key={item.id}
              aria-pressed={item.id === areaId}
              onClick={() => selectArea(item)}
            >
              {item.name}
            </button>
          ))}
        </div>
        <div>
          <span>{w.waterways}</span>
          {visibleWaterways.map((item) => (
            <button
              key={item.id}
              aria-pressed={item.id === waterwayId}
              onClick={() => selectWaterway(item)}
            >
              ≈ {item.name}
            </button>
          ))}
        </div>
      </div>
      <p className="atlas-help" id="atlas-controls">
        {w.controls} {w.artwork}
      </p>
    </section>
  );
}
