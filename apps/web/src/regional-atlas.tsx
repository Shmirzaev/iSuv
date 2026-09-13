import { useEffect, useRef, useState } from 'react';
import type { Locale } from '@isuv/i18n';
import {
  andijanScene,
  savayScene,
  viewForArea,
  type AtlasArea,
  type AtlasWaterway,
} from './regional-atlas-model.js';
import { atlasWords } from './regional-atlas-i18n.js';
import { regionalReferenceData } from './regional-reference-data.js';

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
    if (waterwayId) selectedPanel.current?.focus({ preventScroll: true });
  }, [waterwayId]);
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
    svg.current?.focus({ preventScroll: true });
    setDetail(false);
    setAreaId(null);
    setWaterwayId(null);
    setCamera([0, 0, 1280, 870]);
  }
  function savay() {
    svg.current?.focus({ preventScroll: true });
    setDetail(true);
    setAreaId(null);
    setWaterwayId(null);
    setCamera([100, 15, 1120, 825]);
  }
  function selectArea(item: AtlasArea) {
    if (item.id === 'savay-area') {
      savay();
      return;
    }
    setAreaId(item.id);
    setWaterwayId(null);
    setCamera(viewForArea(item));
  }
  function selectWaterway(item: AtlasWaterway) {
    setWaterwayId(item.id);
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
          <label>
            <input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} />
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
            opacity={original ? 0.8 : 0.7}
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
                fillOpacity={original ? 0.12 : areaId && item.id !== areaId ? 0.3 : 0.73}
                stroke="#607b6b"
                strokeWidth="1.6"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          ))}
          {scene.waterways.map((item) => (
            <g
              key={item.id}
              role={detail || area ? 'button' : undefined}
              tabIndex={detail || area ? 0 : undefined}
              aria-label={item.name}
              aria-pressed={detail || area ? item.id === waterwayId : undefined}
              className={`atlas-waterway ${item.id === waterwayId ? 'is-selected' : ''}`}
              pointerEvents={detail || area ? undefined : 'none'}
              opacity={area && !item.areas.includes(area.id) ? 0.35 : 1}
              onClick={() => {
                if (!suppressClick.current) selectWaterway(item);
              }}
              onKeyDown={(e) => featureKey(e, () => selectWaterway(item))}
            >
              <path
                className="atlas-river-halo"
                d={item.path}
                fill="none"
                stroke="#ffffff"
                strokeWidth="6"
                vectorEffect="non-scaling-stroke"
              />
              <path
                className="atlas-river-line"
                d={item.path}
                fill="none"
                stroke="#087da4"
                strokeWidth="2.5"
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={item.path}
                fill="none"
                stroke="transparent"
                strokeWidth="22"
                vectorEffect="non-scaling-stroke"
              />
              {labels && (
                <text x={item.label[0]} y={item.label[1]} className="atlas-river-label">
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
        {waterway && (
          <aside
            className="atlas-waterway-card"
            ref={selectedPanel}
            tabIndex={-1}
            aria-label={w.selected}
          >
            <button
              className="atlas-card-close"
              aria-label={w.close}
              onClick={() => {
                setWaterwayId(null);
                svg.current?.focus();
              }}
            >
              ×
            </button>
            <span>{w.selected}</span>
            <h3>{waterway.name}</h3>
            {waterway.register ? (
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
        <div className="atlas-reference-badge">{w.reference}</div>
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
