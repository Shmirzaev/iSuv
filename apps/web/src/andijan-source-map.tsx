import { useEffect, useRef, useState } from 'react';
import type { Locale } from '@isuv/i18n';
import { atlasWords } from './regional-atlas-i18n.js';
import { sourceMapWords } from './andijan-source-i18n.js';
import {
  sourceViews,
  fullSourceView,
  featureView,
  constrainCamera,
  zoomSource,
  type SourceFeature,
  type SourceView,
  type Camera,
} from './andijan-source-model.js';

export function AndijanSourceMap({
  locale,
  onRecords,
}: {
  locale: Locale;
  onRecords: (canal: 'savay' | 'oqbura') => void;
}) {
  const w = sourceMapWords[locale];
  const common = atlasWords[locale];
  const [view, setView] = useState<SourceView>('andijan-pdf');
  const [camera, setCamera] = useState<Camera>(fullSourceView('andijan-pdf'));
  const [selectedId, setSelectedId] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const svg = useRef<SVGSVGElement>(null);
  const container = useRef<HTMLElement>(null);
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; y: number; scale: number; camera: Camera } | null>(null);
  const pointers = useRef(new Map<number, [number, number]>());
  const pinch = useRef<{ distance: number; camera: Camera; at: [number, number] } | null>(null);
  const moved = useRef(false);
  const scene = sourceViews[view];
  const features: SourceFeature[] = scene.features;
  const selected = features.find((item) => item.id === selectedId);
  const titles: Record<SourceView, string> = {
    'andijan-pdf': w.pdf,
    'andijan-irrigation': w.irrigation,
    savay: w.savay,
  };

  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === container.current);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);
  useEffect(() => {
    if (selectedId) panel.current?.focus({ preventScroll: true });
  }, [selectedId, view]);
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const matrix = element.getScreenCTM();
      if (!matrix) return;
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      setCamera((current) =>
        zoomSource(view, current, event.deltaY > 0 ? 1.15 : 1 / 1.15, [point.x, point.y]),
      );
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [view]);

  function reset() {
    setCamera(fullSourceView(view));
    setSelectedId('');
  }
  function openView(next: SourceView) {
    setView(next);
    setCamera(fullSourceView(next));
    setSelectedId('');
    setFailed(false);
    setLoaded(false);
    drag.current = null;
    pinch.current = null;
    pointers.current.clear();
  }
  function choose(id: string) {
    const feature = features.find((item) => item.id === id);
    if (!feature) {
      reset();
      return;
    }
    setSelectedId(id);
    setCamera(featureView(view, feature));
  }
  function zoom(factor: number) {
    setCamera((current) => zoomSource(view, current, factor));
  }
  function finishPointer(id: number) {
    pointers.current.delete(id);
    if (svg.current?.hasPointerCapture(id)) svg.current.releasePointerCapture(id);
    drag.current = null;
    pinch.current = null;
  }
  async function records(canal: 'savay' | 'oqbura') {
    if (document.fullscreenElement === container.current) await document.exitFullscreen();
    onRecords(canal);
  }

  return (
    <section className="andijan-source-map" ref={container} aria-label={common.map}>
      <div className="source-map-toolbar">
        <label>
          {w.view}
          <select value={view} onChange={(event) => openView(event.target.value as SourceView)}>
            {Object.entries(titles).map(([id, title]) => (
              <option key={id} value={id}>
                {title}
              </option>
            ))}
          </select>
        </label>
        <label className="source-map-finder">
          {w.find}
          <select value={selectedId} onChange={(event) => choose(event.target.value)}>
            <option value="">{w.all}</option>
            <optgroup label={w.districts}>
              {features
                .filter((item) => ['district', 'irrigation'].includes(item.kind))
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </optgroup>
            <optgroup label={w.features}>
              {features
                .filter((item) => !['district', 'irrigation'].includes(item.kind))
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {item.kind === 'point' ? ` · ${common.point}` : ''}
                  </option>
                ))}
            </optgroup>
          </select>
        </label>
        <button
          type="button"
          onClick={async () => {
            if (document.fullscreenElement === container.current) await document.exitFullscreen();
            else await container.current?.requestFullscreen().catch(() => undefined);
          }}
        >
          {fullscreen ? common.exit : common.full} ⛶
        </button>
      </div>
      <div className="source-map-canvas">
        <svg
          ref={svg}
          viewBox={camera.join(' ')}
          data-source-view={view}
          role="group"
          aria-label={common.map}
          aria-describedby="source-map-hint"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            const step = camera[2] * 0.12;
            if (
              [
                '+',
                '=',
                '-',
                'ArrowLeft',
                'ArrowRight',
                'ArrowUp',
                'ArrowDown',
                'Escape',
                'Home',
              ].includes(event.key)
            )
              event.preventDefault();
            if (event.key === '+' || event.key === '=') zoom(0.75);
            if (event.key === '-') zoom(1.3);
            if (event.key === 'Escape' || event.key === 'Home') reset();
            if (event.key.startsWith('Arrow'))
              setCamera(([x, y, width, height]) =>
                constrainCamera(view, [
                  x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
                  y + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0),
                  width,
                  height,
                ]),
              );
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            pointers.current.set(event.pointerId, [event.clientX, event.clientY]);
            const matrix = event.currentTarget.getScreenCTM();
            if (!matrix) return;
            if (pointers.current.size === 2) {
              const [a, b] = [...pointers.current.values()] as [[number, number], [number, number]];
              const point = new DOMPoint((a[0] + b[0]) / 2, (a[1] + b[1]) / 2).matrixTransform(
                matrix.inverse(),
              );
              pinch.current = {
                distance: Math.hypot(a[0] - b[0], a[1] - b[1]),
                camera,
                at: [point.x, point.y],
              };
              moved.current = true;
              drag.current = null;
              return;
            }
            moved.current = false;
            drag.current = { x: event.clientX, y: event.clientY, camera, scale: 1 / matrix.a };
          }}
          onPointerMove={(event) => {
            if (!pointers.current.has(event.pointerId)) return;
            pointers.current.set(event.pointerId, [event.clientX, event.clientY]);
            if (pinch.current && pointers.current.size === 2) {
              const [a, b] = [...pointers.current.values()] as [[number, number], [number, number]];
              const distance = Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1]));
              setCamera(
                zoomSource(
                  view,
                  pinch.current.camera,
                  pinch.current.distance / distance,
                  pinch.current.at,
                ),
              );
              return;
            }
            const start = drag.current;
            if (!start) return;
            const dx = event.clientX - start.x;
            const dy = event.clientY - start.y;
            if (Math.hypot(dx, dy) > 5) {
              moved.current = true;
              event.currentTarget.setPointerCapture(event.pointerId);
              setCamera(
                constrainCamera(view, [
                  start.camera[0] - dx * start.scale,
                  start.camera[1] - dy * start.scale,
                  start.camera[2],
                  start.camera[3],
                ]),
              );
            }
          }}
          onPointerUp={(event) => finishPointer(event.pointerId)}
          onPointerCancel={(event) => {
            moved.current = true;
            finishPointer(event.pointerId);
          }}
          onPointerLeave={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId))
              finishPointer(event.pointerId);
          }}
          onClick={(event) => {
            if (moved.current) return;
            const featureId = (event.target as Element)
              .closest('[data-feature]')
              ?.getAttribute('data-feature');
            if (featureId) {
              choose(featureId);
              return;
            }
            const matrix = event.currentTarget.getScreenCTM();
            if (!matrix) return;
            const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
              matrix.inverse(),
            );
            setCamera((current) => zoomSource(view, current, 0.5, [point.x, point.y]));
          }}
        >
          <title>{titles[view]}</title>
          <image
            key={`${view}-${attempt}`}
            href={scene.asset}
            width={scene.width}
            height={scene.height}
            onLoad={() => {
              setLoaded(true);
              setFailed(false);
            }}
            onError={() => {
              setFailed(true);
              setLoaded(false);
            }}
          />
          {features
            .filter(
              (item) =>
                ['district', 'irrigation', 'waterway'].includes(item.kind) ||
                camera[2] < scene.width * 0.65 ||
                item.id === selectedId,
            )
            .map((item) => {
              const [x, y, width, height] = item.bounds;
              const hitProps = {
                'data-feature': item.id,
                'data-kind': item.kind,
                className: `source-map-hit${selectedId === item.id ? ' is-selected' : ''}${item.kind === 'waterway' ? ' is-waterway' : ''}`,
                role: 'button',
                tabIndex: 0,
                'aria-label': item.name,
                'aria-pressed': selectedId === item.id,
                onKeyDown: (event: React.KeyboardEvent<SVGElement>) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    event.stopPropagation();
                    choose(item.id);
                  }
                },
              };
              return item.path ? (
                <path key={item.id} {...hitProps} d={item.path}>
                  <title>{item.name}</title>
                </path>
              ) : (
                <rect
                  key={item.id}
                  {...hitProps}
                  x={x - 3}
                  y={y - 3}
                  width={Math.max(16, width + 6)}
                  height={Math.max(12, height + 6)}
                  rx={2}
                >
                  <title>{item.name}</title>
                </rect>
              );
            })}
        </svg>
        {!loaded && (
          <div className="source-map-loading" role={failed ? 'alert' : 'status'}>
            <span>{failed ? w.failed : w.loading}</span>
            {failed && (
              <button
                type="button"
                onClick={() => {
                  setFailed(false);
                  setAttempt((value) => value + 1);
                }}
              >
                {w.retry}
              </button>
            )}
          </div>
        )}
        <div className="source-map-zoom" aria-label={common.controls}>
          <button type="button" onClick={() => zoom(0.7)} aria-label={common.zoomIn}>
            +
          </button>
          <output aria-label={w.view}>{Math.round((scene.width / camera[2]) * 100)}%</output>
          <button type="button" onClick={() => zoom(1 / 0.7)} aria-label={common.zoomOut}>
            −
          </button>
          <button type="button" onClick={reset} aria-label={common.reset}>
            ↺
          </button>
        </div>
        {selected && (
          <aside
            className="source-map-selection"
            ref={panel}
            tabIndex={-1}
            aria-label={w.selection}
          >
            <div>
              <strong>{selected.name}</strong>
              <button
                type="button"
                aria-label={common.close}
                onClick={() => {
                  setSelectedId('');
                  svg.current?.focus();
                }}
              >
                ×
              </button>
            </div>
            <p>
              {w.sourceLabel}: {selected.sourceLabel}
            </p>
            <p>{selected.kind === 'point' ? common.pointNote : w.noLive}</p>
            {selected.register && (
              <>
                <p>{common.unlocated}</p>
                <button type="button" onClick={() => void records(selected.register!)}>
                  {common.records} ({selected.register === 'savay' ? 61 : 3}) →
                </button>
              </>
            )}
            {((view === 'andijan-pdf' &&
              ['qorgontepa', 'jalaquduq', 'xojaobod'].includes(selected.id)) ||
              (view === 'andijan-irrigation' && selected.id === 'savay-area')) && (
              <button type="button" onClick={() => openView('savay')}>
                {w.related} →
              </button>
            )}
          </aside>
        )}
      </div>
      <div className="source-map-footer">
        <p id="source-map-hint">{w.hint}</p>
        <span>{w.reference}</span>
        {view === 'savay' && (
          <div className="source-map-record-links">
            <button type="button" onClick={() => choose('savay')}>
              ≈ Savay
            </button>
            <button type="button" onClick={() => choose('oqbura')}>
              ≈ Oqbura-soy
            </button>
          </div>
        )}
        <details>
          <summary>{w.notice}</summary>
          <p>{view === 'andijan-pdf' ? w.fidelity : w.raster}</p>
          <p>{common.controls}</p>
          <a href={scene.asset} target="_blank" rel="noreferrer">
            {w.open} · {scene.source} ↗
          </a>
        </details>
      </div>
    </section>
  );
}
