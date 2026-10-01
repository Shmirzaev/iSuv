/**
 * The data and cartographic constants for the supplied Andijon map.  These
 * values intentionally retain the source map's Uzbek labels and visual
 * definitions; presentation chrome belongs in andijan-map.tsx/CSS.
 */

export type GeometryType =
  'Point' | 'LineString' | 'MultiLineString' | 'Polygon' | 'MultiPolygon' | 'GeometryCollection';

export interface AndijanFeatureProperties {
  name?: string;
  aliases?: string;
  district?: string;
  t?: string;
  no?: string | number;
  len?: number;
  area?: number;
  area_km2?: number;
  doc_len_m?: number;
  int?: boolean;
  src?: string;
  [key: string]: unknown;
}

export interface AndijanFeature {
  type: 'Feature';
  properties: AndijanFeatureProperties;
  geometry: { type: GeometryType; coordinates?: unknown } | null;
  id?: string | number;
}

export interface FeatureCollection {
  type: 'FeatureCollection';
  features: AndijanFeature[];
}

export type AndijanMapData = Record<string, FeatureCollection>;
export type DistrictMapData = Record<string, AndijanMapData>;

export interface OverlayDefinition {
  file: string;
  bounds: [[number, number], [number, number]];
  title: string;
  conf: string;
  note: string;
}

export interface AndijanStats {
  dist_table?: DistrictStatRow[];
  rows?: [string, string, number[], [string, number] | null, number][];
  [key: string]: unknown;
}

export interface DistrictStatRow {
  district: string;
  canals_ha?: number;
  canals_km?: number;
  canals_cnt?: number;
  col_km?: number;
  col_cnt?: number;
  wells_cnt?: number;
}

export type LayerType = 'pt' | 'line' | 'poly';
export type LayerGroup = 'pilot' | 'kmz' | 'off' | 'zone' | 'osm';

export interface LayerDefinition {
  id: string;
  g: LayerGroup;
  key: string;
  label: string;
  type: LayerType;
  color?: string;
  fill?: string;
  fillOpacity?: number;
  w?: number;
  dash?: string;
  kind: string;
  pane: keyof typeof ANDIJAN_PANES;
  list?: boolean;
  off?: boolean;
  nofill?: boolean;
  chips?: boolean;
  colors?: Record<string, string>;
}

/** Exact z-index values in the supplied Leaflet template. */
export const ANDIJAN_PANES = {
  img: 250,
  poly: 405,
  osm: 410,
  kmz: 415,
  off: 425,
  pilot: 435,
  pt: 440,
} as const;

/** Exact source point-type labels and colours. */
export const ANDIJAN_POINT_TYPES = {
  pump: ['Nasos stansiyasi', '#e11d48'],
  tower: ['Suv minorasi', '#7c3aed'],
  works: ['Suv tozalash / inshoot', '#0891b2'],
  sewage: ['Oqava suv tozalash', '#92400e'],
  tank: ["Suv sig'imi (rezervuar)", '#64748b'],
  well: ["Kuzatuv qudug'i", '#16a34a'],
  dam: ["To'g'on / to'siq", '#111827'],
  fall: ['Sharshara', '#0ea5e9'],
  dyuker: ['Dyuker / akveduk', '#0d9488'],
  gu: ['Gidrouzel', '#0f172a'],
  head: ['Bosh inshoot', '#4f46e5'],
  ges: ['GES (kichik)', '#ca8a04'],
  post: ['Post', '#f59e0b'],
} as const;

/** Exact source layer definitions. Do not substitute design-system colours here. */
export const ANDIJAN_LAYERS: readonly LayerDefinition[] = [
  {
    id: 'pilot',
    g: 'pilot',
    key: 'pilot',
    label: 'Pilot konturini ko‘rsatish',
    type: 'poly',
    color: '#be185d',
    fill: '#fb7185',
    fillOpacity: 0.16,
    w: 4,
    kind: 'Aqlli suv tajriba hududi',
    pane: 'pilot',
    list: true,
  },
  {
    id: 'kmz_canals',
    g: 'kmz',
    key: 'kmz_canals',
    label: 'Nomlangan kanallar (KMZ)',
    type: 'line',
    color: '#d97706',
    w: 2.4,
    kind: 'Kanal (KMZ)',
    pane: 'kmz',
    list: true,
  },
  {
    id: 'kmz_lines',
    g: 'kmz',
    key: 'kmz_lines',
    label: "Qo'lda chizilgan kanal izlari (KMZ)",
    type: 'line',
    color: '#a855f7',
    w: 2,
    dash: '3 3',
    kind: "Kanal izi (qo'lda chizilgan)",
    pane: 'kmz',
    list: true,
    off: true,
  },
  {
    id: 'kollektor_xa',
    g: 'kmz',
    key: 'kollektor_xa',
    label: "Xo'jaliklararo zovurlar",
    type: 'line',
    color: '#7c3aed',
    w: 2.8,
    dash: '6 3',
    kind: "Xo'jaliklararo kollektor",
    pane: 'kmz',
    list: true,
  },
  {
    id: 'quduq',
    g: 'kmz',
    key: 'quduq',
    label: 'Gidrogeologik kuzatuv quduqlari',
    type: 'pt',
    kind: "Kuzatuv qudug'i",
    pane: 'pt',
    list: true,
    off: true,
  },
  {
    id: 'kak',
    g: 'off',
    key: 'kak',
    label: 'Katta Andijon kanali (BAK)',
    type: 'line',
    color: '#dc2626',
    w: 4.5,
    kind: 'Katta Andijon kanali',
    pane: 'off',
    list: true,
  },
  {
    id: 'aro',
    g: 'off',
    key: 'aro',
    label: "Xo'jaliklararo kanallar (shapefile)",
    type: 'line',
    color: '#2563eb',
    w: 3,
    kind: "Xo'jaliklararo kanal (Shp)",
    pane: 'off',
    list: true,
  },
  {
    id: 'ich',
    g: 'off',
    key: 'ich',
    label: "Xo'jalik ichi kanallari (shapefile)",
    type: 'line',
    color: '#0d9488',
    w: 1.8,
    kind: "Xo'jalik ichi kanal (Shp)",
    pane: 'off',
  },
  {
    id: 'tuman',
    g: 'zone',
    key: 'tuman',
    label: 'Tuman chegaralari',
    type: 'poly',
    color: '#334155',
    nofill: true,
    dash: '5 4',
    kind: 'Tuman',
    pane: 'poly',
    list: true,
  },
  {
    id: 'itb',
    g: 'zone',
    key: 'itb',
    label: 'ITB hududlari',
    type: 'poly',
    color: '#475569',
    fill: '#94a3b8',
    colors: {
      'Andijonsoy ITB': '#eab308',
      'Qoradaryo–Mayliysoy ITB': '#fb923c',
      'Savay–Oqburasoy ITB': '#a16207',
      "Ulug'nor–Mazgilsoy ITB": '#ec4899',
      'Shahrixonsoy ITB': '#6366f1',
    },
    kind: 'ITB hududi',
    pane: 'poly',
    list: true,
    off: true,
  },
  {
    id: 'systems',
    g: 'zone',
    key: 'systems',
    label: "Sug'orish tizimlari (tarixiy sxema, taxminiy)",
    type: 'poly',
    color: '#475569',
    fill: '#94a3b8',
    colors: {
      BAK: '#ca8a04',
      BFK: '#db2777',
      Andijonsoy: '#facc15',
      Paxtaobod: '#f97316',
      "Yuqori Ulug'nor": '#ea580c',
      Savay: '#dc2626',
      Siza: '#be123c',
      Tentyaksoy: '#0f766e',
      Aravonsoy: '#10b981',
      Oqbura: '#0ea5e9',
      YuFK: '#65a30d',
      Shahrixonsoy: '#a855f7',
      "Andijon suv ombori o'ng qirg'oq kanali": '#94a3b8',
    },
    kind: "Sug'orish tizimi",
    pane: 'poly',
    list: true,
    off: true,
  },
  {
    id: 'adir',
    g: 'zone',
    key: 'adir',
    label: "Adir yerlar (o'zlashtirilmagan)",
    type: 'poly',
    color: '#64748b',
    fill: '#9ca3af',
    kind: 'Adir yer',
    pane: 'poly',
    off: true,
  },
  {
    id: 'o_river',
    g: 'osm',
    key: 'osm_river',
    label: 'Daryo va soylar',
    type: 'line',
    color: '#1d4ed8',
    w: 3,
    kind: 'Daryo / soy',
    pane: 'osm',
    list: true,
  },
  {
    id: 'o_canal',
    g: 'osm',
    key: 'osm_canal',
    label: 'Kanallar (OSM + ITB xaritasi)',
    type: 'line',
    color: '#0284c7',
    w: 2.5,
    kind: 'Kanal',
    pane: 'osm',
    list: true,
  },
  {
    id: 'o_ditch',
    g: 'osm',
    key: 'osm_ditch',
    label: 'Ariqlar va tarmoq kanallari',
    type: 'line',
    color: '#16a34a',
    w: 1.8,
    kind: 'Ariq / tarmoq kanali',
    pane: 'osm',
    list: true,
  },
  {
    id: 'o_drain',
    g: 'osm',
    key: 'osm_drain',
    label: 'Zovur / kollektorlar (OSM + ITB)',
    type: 'line',
    color: '#ea580c',
    w: 2,
    dash: '6 4',
    kind: 'Zovur / kollektor',
    pane: 'osm',
    list: true,
  },
  {
    id: 'o_stream',
    g: 'osm',
    key: 'osm_stream',
    label: 'Sel va kichik oqimlar',
    type: 'line',
    color: '#8b5cf6',
    w: 1.5,
    kind: 'Oqim (soy)',
    pane: 'osm',
    list: true,
  },
  {
    id: 'o_dam',
    g: 'osm',
    key: 'osm_dam',
    label: "To'g'on va to'siqlar",
    type: 'line',
    color: '#111827',
    w: 4,
    kind: "To'g'on / to'siq",
    pane: 'osm',
    list: true,
  },
  {
    id: 'o_lake',
    g: 'osm',
    key: 'osm_lake',
    label: "Suv omborlari, ko'l va suv havzalari",
    type: 'poly',
    color: '#2563eb',
    fill: '#60a5fa',
    kind: "Suv ombori / ko'l",
    pane: 'poly',
    list: true,
  },
  {
    id: 'o_pond',
    g: 'osm',
    key: 'osm_pond',
    label: 'Hovuzlar',
    type: 'poly',
    color: '#0891b2',
    fill: '#67e8f9',
    kind: 'Hovuz',
    pane: 'poly',
    list: true,
  },
  {
    id: 'o_ww',
    g: 'osm',
    key: 'osm_wastewater',
    label: 'Oqava suv havzalari',
    type: 'poly',
    color: '#92400e',
    fill: '#d6a86b',
    kind: 'Oqava suv havzasi',
    pane: 'poly',
    list: true,
  },
  {
    id: 'o_pt',
    g: 'osm',
    key: 'osm_pt',
    label: 'Inshootlar (nasos, gidrouzel, GES, minora…)',
    type: 'pt',
    kind: 'Inshoot',
    pane: 'pt',
    list: true,
    chips: true,
  },
] as const;

export const ANDIJAN_FIDELITY_MANIFEST = {
  panes: ANDIJAN_PANES,
  pointTypes: ANDIJAN_POINT_TYPES,
  layers: ANDIJAN_LAYERS,
} as const;

export interface LeafletStyle {
  radius?: number;
  color?: string | undefined;
  weight?: number | undefined;
  fill?: boolean;
  fillColor?: string | undefined;
  fillOpacity?: number;
  opacity?: number;
  dashArray?: string | null;
}

/** Source Leaflet style logic, made pure for a React Leaflet adapter. */
export function styleOf(
  layer: LayerDefinition,
  properties: AndijanFeatureProperties,
): LeafletStyle {
  if (layer.type === 'pt') {
    const pointType =
      ANDIJAN_POINT_TYPES[properties.t as keyof typeof ANDIJAN_POINT_TYPES] ??
      ANDIJAN_POINT_TYPES.well;
    return { radius: 5, color: '#fff', weight: 1.5, fillColor: pointType[1], fillOpacity: 0.95 };
  }
  if (layer.type === 'poly') {
    if (layer.nofill)
      return {
        color: layer.color,
        weight: 1.6,
        fill: false,
        dashArray: layer.dash ?? null,
        opacity: 0.95,
      };
    const colour = layer.colors?.[String(properties.name ?? '')];
    return {
      color: colour ?? layer.color,
      weight: layer.w ?? 1.2,
      fillColor: colour ?? layer.fill,
      fillOpacity: layer.fillOpacity ?? 0.4,
    };
  }
  return { color: layer.color, weight: layer.w, opacity: 0.92, dashArray: layer.dash ?? null };
}

/** Source mouseover style, retained separately from selection paint. */
export function hoverStyle(layer: LayerDefinition): LeafletStyle {
  if (layer.type === 'line') return { weight: (layer.w ?? 0) + 3, opacity: 1 };
  if (layer.type === 'pt') return { radius: 8 };
  return { weight: Math.max(layer.w ?? 1.2, 3) + 1, fillOpacity: 0.75 };
}

export function formatKilometres(metres: number): string {
  return `${(metres / 1000).toLocaleString('uz', { maximumFractionDigits: 1 })} km`;
}

export function formatArea(squareMetres: number): string {
  if (squareMetres >= 1_000_000)
    return `${(squareMetres / 1_000_000).toLocaleString('uz', { maximumFractionDigits: 2 })} km²`;
  if (squareMetres < 1_000)
    return `${squareMetres.toLocaleString('uz', { maximumFractionDigits: 0 })} m²`;
  return `${(squareMetres / 10_000).toLocaleString('uz', { maximumFractionDigits: 2 })} ga`;
}

export function escapeHtml(value: unknown): string {
  return String(value).replace(
    /[&<>"]/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]!,
  );
}

/** Exact source tooltip content, including source accuracy caveats. */
export function tooltipHtml(layer: LayerDefinition, properties: AndijanFeatureProperties): string {
  const name = properties.name || (properties.no ? `№ ${properties.no}` : '');
  const kind =
    layer.type === 'pt'
      ? (ANDIJAN_POINT_TYPES[properties.t as keyof typeof ANDIJAN_POINT_TYPES] ??
          ANDIJAN_POINT_TYPES.well)[0]
      : layer.kind;
  const area =
    properties.area ?? (properties.area_km2 == null ? undefined : properties.area_km2 * 1e6);
  if (layer.id === 'pilot')
    return `<b>${escapeHtml(name)}</b><br>Aqlli suv tajriba hududi<br>KMZ konturi: ${formatArea(area ?? 0)}<br>Hujjatdagi kanal uzunligi: ${formatKilometres(properties.doc_len_m ?? 0)}<br><small>Suv chiqishlarining aniq nuqtalari hali kiritilmagan.</small>`;
  const size =
    properties.len != null && properties.len > 0
      ? `Uzunligi: ${formatKilometres(properties.len)}`
      : area != null && area > 0
        ? `Maydoni: ${formatArea(area)}`
        : '';
  const district = properties.district ? `Tumani: ${escapeHtml(properties.district)}<br>` : '';
  const seasonal = properties.int ? ' · mavsumiy' : '';
  const source =
    properties.src === 'itb'
      ? '<br><small>Manba: ITB xaritasi (sxemadan, taxminiy joylashuv)</small>'
      : properties.src === 'osm'
        ? '<br><small>Manba: OpenStreetMap</small>'
        : properties.src === 'sxema'
          ? '<br><small>Manba: gidrotexnik sxema (taxminiy joylashuv ±2–3 km)</small>'
          : '';
  return `<b>${escapeHtml(name || kind)}</b><br>${escapeHtml(kind)}${seasonal}<br>${district}${size}${source}`;
}

export interface LayerSummary {
  count: number;
  totalLength: number;
  text: string;
}

export function layerSummary(layer: LayerDefinition, collection?: FeatureCollection): LayerSummary {
  const features = collection?.features ?? [];
  const totalLength = features.reduce(
    (sum, feature) =>
      sum + (typeof feature.properties.len === 'number' ? feature.properties.len : 0),
    0,
  );
  return {
    count: features.length,
    totalLength,
    text:
      layer.type === 'line'
        ? `${features.length} ta · ${formatKilometres(totalLength)}`
        : `${features.length} ta`,
  };
}

export interface SearchRow {
  id: string;
  layerId: string;
  name: string;
  aliases: string;
  district: string;
  kind: string;
  layer: LayerDefinition;
  features: AndijanFeature[];
  length: number;
  area: number;
  size: string;
  parts: number;
}

/**
 * Source `rowForFeature` fallback. Some source layers deliberately do not
 * participate in search, and several features have only an object number;
 * clicking them must still make a selectable row.
 */
export function rowForFeature(layer: LayerDefinition, feature: AndijanFeature): SearchRow {
  const properties = feature.properties;
  const name =
    properties.name || (properties.no ? `№ ${properties.no}` : layer.kind || layer.label);
  const length = typeof properties.len === 'number' ? properties.len : 0;
  const area =
    typeof properties.area === 'number'
      ? properties.area
      : typeof properties.area_km2 === 'number'
        ? properties.area_km2 * 1e6
        : 0;
  const kind =
    layer.type === 'pt'
      ? (ANDIJAN_POINT_TYPES[properties.t as keyof typeof ANDIJAN_POINT_TYPES] ??
          ANDIJAN_POINT_TYPES.well)[0]
      : layer.kind;
  const district = properties.district ?? '';
  const id = `${layer.id}|${name}|${district}|${String(feature.id ?? '')}`;
  return {
    id,
    layerId: layer.id,
    name,
    aliases: properties.aliases ?? '',
    district,
    kind,
    layer,
    features: [feature],
    length,
    area,
    size: length ? formatKilometres(length) : area ? formatArea(area) : '',
    parts: 1,
  };
}

export function buildSearchRows(data: AndijanMapData): SearchRow[] {
  const grouped = new Map<string, Omit<SearchRow, 'id' | 'layerId' | 'size' | 'parts'>>();
  for (const layer of ANDIJAN_LAYERS) {
    if (!layer.list) continue;
    for (const feature of data[layer.key]?.features ?? []) {
      const properties = feature.properties;
      if (!properties.name) continue;
      const district = properties.district ?? '';
      const identity = `${layer.id}|${properties.name}|${district}`;
      const existing = grouped.get(identity);
      const length = typeof properties.len === 'number' ? properties.len : 0;
      const area =
        typeof properties.area === 'number'
          ? properties.area
          : typeof properties.area_km2 === 'number'
            ? properties.area_km2 * 1e6
            : 0;
      if (existing) {
        existing.features.push(feature);
        existing.length += length;
        existing.area += area;
      } else {
        const kind =
          layer.type === 'pt'
            ? (ANDIJAN_POINT_TYPES[properties.t as keyof typeof ANDIJAN_POINT_TYPES] ??
                ANDIJAN_POINT_TYPES.well)[0]
            : layer.kind;
        grouped.set(identity, {
          name: properties.name,
          aliases: properties.aliases ?? '',
          district,
          kind,
          layer,
          features: [feature],
          length,
          area,
        });
      }
    }
  }
  return [...grouped.values()]
    .map((row) => ({
      ...row,
      id: `${row.layer.id}|${row.name}|${row.district}`,
      layerId: row.layer.id,
      size: row.length ? formatKilometres(row.length) : row.area ? formatArea(row.area) : '',
      parts: row.features.length,
    }))
    .sort(
      (left, right) =>
        Number(right.layer.id === 'pilot') - Number(left.layer.id === 'pilot') ||
        left.name.localeCompare(right.name, 'uz'),
    );
}

export function searchRows(
  rows: readonly SearchRow[],
  query: string,
  limit = Number.POSITIVE_INFINITY,
): SearchRow[] {
  const needle = query.trim().toLocaleLowerCase('uz');
  if (!needle) return [];
  return rows
    .filter((row) =>
      `${row.name} ${row.aliases} ${row.district} ${row.kind}`
        .toLocaleLowerCase('uz')
        .includes(needle),
    )
    .slice(0, limit);
}

/** The source bundle already clips vectors by district; never re-project or clip them again. */
export function districtData(
  data: AndijanMapData,
  districts: DistrictMapData,
  district: string | null,
): AndijanMapData {
  return district ? (districts[district] ?? data) : data;
}

export interface StatisticsTable {
  rows: DistrictStatRow[];
  totals: { canalsKm: number; collectorKm: number; wells: number };
  district: string | null;
}

export function calculateStatistics(
  data: AndijanMapData,
  stats: AndijanStats,
  district: string | null,
): StatisticsTable {
  if (district) {
    const canals = [...(data.kmz_canals?.features ?? []), ...(data.pilot?.features ?? [])];
    const collectors = data.kollektor_xa?.features ?? [];
    const wells = data.quduq?.features ?? [];
    const number = (value: unknown) => (typeof value === 'number' ? value : 0);
    const row: DistrictStatRow = {
      district,
      canals_ha: canals.reduce((sum, item) => sum + number(item.properties.area), 0) / 10_000,
      canals_km: canals.reduce((sum, item) => sum + number(item.properties.len), 0) / 1_000,
      canals_cnt: canals.length,
      col_km: collectors.reduce((sum, item) => sum + number(item.properties.len), 0) / 1_000,
      col_cnt: collectors.length,
      wells_cnt: wells.length,
    };
    return {
      rows: [row],
      totals: {
        canalsKm: row.canals_km ?? 0,
        collectorKm: row.col_km ?? 0,
        wells: row.wells_cnt ?? 0,
      },
      district,
    };
  }
  const rows = stats.dist_table ?? [];
  return {
    rows,
    totals: rows.reduce(
      (total, row) => ({
        canalsKm: total.canalsKm + (row.canals_km ?? 0),
        collectorKm: total.collectorKm + (row.col_km ?? 0),
        wells: total.wells + (row.wells_cnt ?? 0),
      }),
      { canalsKm: 0, collectorKm: 0, wells: 0 },
    ),
    district: null,
  };
}

export interface AndijanMapPayload {
  data: AndijanMapData;
  districts: DistrictMapData;
  overlays: Record<string, OverlayDefinition>;
  stats: AndijanStats;
}

export type FetchJson = (input: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

let payloadRequest: Promise<AndijanMapPayload> | null = null;

function collectionRecord(value: unknown): AndijanMapData {
  return value as AndijanMapData;
}

/** Lazy-load once on opening the workspace. Failed requests deliberately remain retryable. */
export function loadAndijanMapData(
  fetchJson: FetchJson = (input) => fetch(input),
): Promise<AndijanMapPayload> {
  if (payloadRequest) return payloadRequest;
  payloadRequest = Promise.all(
    ['data.json', 'districts.json', 'overlays.json', 'stats.json'].map(async (file) => {
      const response = await fetchJson(`/andijon-map/${file}`);
      if (!response.ok) throw new Error(`Unable to load ${file}`);
      return response.json();
    }),
  ).then(([data, districts, overlays, stats]) => ({
    data: collectionRecord(data),
    districts: districts as DistrictMapData,
    overlays: overlays as Record<string, OverlayDefinition>,
    stats: stats as AndijanStats,
  }));
  payloadRequest.catch(() => {
    payloadRequest = null;
  });
  return payloadRequest;
}

/** Tests and a retry control can reset the in-memory request only; static data is untouched. */
export function resetAndijanMapDataCache(): void {
  payloadRequest = null;
}
