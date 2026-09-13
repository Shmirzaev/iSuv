import index from './andijan-source-index.json' with { type: 'json' };
import { atlasDetail } from './regional-atlas-detail.js';
import { andijanScene, savayScene } from './regional-atlas-model.js';

export type SourceView = 'andijan-pdf' | 'andijan-irrigation' | 'savay';
export type Camera = [number, number, number, number];
export type SourceFeature = {
  id: string;
  name: string;
  sourceLabel: string;
  kind: string;
  at: [number, number];
  bounds: Camera;
  /** Navigation hit target only; never a geographic or accounting boundary. */
  path?: string;
  register?: 'savay' | 'oqbura';
};

export const andijanSourceIndex = index;
export const sourceViews = {
  'andijan-pdf': {
    asset: index.asset,
    source: 'Харита.pdf · 1',
    width: index.width,
    height: index.height,
    features: index.features.map((item): SourceFeature => {
      const [x, y, right, bottom] = item.bounds as Camera;
      return {
        ...item,
        at: [(x + right) / 2, (y + bottom) / 2],
        bounds: [x, y, right - x, bottom - y],
      };
    }),
  },
  'andijan-irrigation': {
    asset: '/regional-maps/andijan-irrigation.webp',
    source: 'АНДИЖОН ВИЛОЯТИ ИРРИГАЦИЯ ХАРИТАСИ',
    width: 1280,
    height: 869,
    features: andijanScene.areas.map((area): SourceFeature => ({
      id: area.id,
      name: area.name,
      sourceLabel: area.name,
      kind: 'irrigation',
      at: area.label,
      bounds: area.bounds,
      path: area.path,
    })),
  },
  savay: {
    asset: '/regional-maps/savay-area.webp',
    source: 'Savay · Oqbura',
    width: 1280,
    height: 905,
    features: [
      ...savayScene.areas.map((area): SourceFeature => ({
        id: area.id,
        name: area.name,
        sourceLabel: area.name,
        kind: 'district',
        at: area.label,
        bounds: [area.label[0] - 30, area.label[1] - 10, 60, 20],
      })),
      ...atlasDetail.savay.landmarks.map((item): SourceFeature => ({
        ...item,
        bounds: [item.at[0] - 7, item.at[1] - 7, 14, 14],
      })),
      ...savayScene.waterways
        .filter((item) => item.register)
        .map((item): SourceFeature => ({
          id: item.id,
          name: item.name,
          sourceLabel: item.name,
          kind: 'waterway',
          at: item.label,
          bounds: [item.label[0] - 25, item.label[1] - 10, 50, 20],
          path: item.path,
          register: item.register!,
        })),
    ],
  },
} satisfies Record<
  SourceView,
  {
    asset: string;
    source: string;
    width: number;
    height: number;
    features: SourceFeature[];
  }
>;

export function fullSourceView(view: SourceView): Camera {
  const scene = sourceViews[view];
  return [0, 0, scene.width, scene.height];
}

/** Keep some map on screen, even after repeated wheel/keyboard gestures. */
export function constrainCamera(view: SourceView, camera: Camera): Camera {
  const scene = sourceViews[view];
  const width = Math.min(scene.width * 1.3, Math.max(scene.width / 16, camera[2]));
  const height = (width * scene.height) / scene.width;
  return [
    Math.max(-width * 0.4, Math.min(scene.width - width * 0.6, camera[0])),
    Math.max(-height * 0.4, Math.min(scene.height - height * 0.6, camera[1])),
    width,
    height,
  ];
}

export function zoomSource(
  view: SourceView,
  camera: Camera,
  factor: number,
  at?: [number, number],
): Camera {
  const [x, y, width, height] = camera;
  const point = at ?? [x + width / 2, y + height / 2];
  const nextWidth = Math.min(
    sourceViews[view].width * 1.3,
    Math.max(sourceViews[view].width / 16, width * factor),
  );
  const ratio = nextWidth / width;
  return constrainCamera(view, [
    point[0] - (point[0] - x) * ratio,
    point[1] - (point[1] - y) * ratio,
    nextWidth,
    height * ratio,
  ]);
}

export function featureView(view: SourceView, feature: SourceFeature): Camera {
  const scene = sourceViews[view];
  const width =
    feature.kind === 'irrigation'
      ? feature.bounds[2] * 1.2
      : scene.width * (feature.kind === 'district' ? 0.28 : 0.15);
  const height = (width * scene.height) / scene.width;
  return constrainCamera(view, [
    feature.at[0] - width / 2,
    feature.at[1] - height / 2,
    width,
    height,
  ]);
}
