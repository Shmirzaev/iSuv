import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ANDIJAN_LAYERS,
  ANDIJAN_PANES,
  ANDIJAN_POINT_TYPES,
  buildSearchRows,
  calculateStatistics,
  districtData,
  formatArea,
  formatKilometres,
  loadAndijanMapData,
  resetAndijanMapDataCache,
  rowForFeature,
  searchRows,
  styleOf,
  tooltipHtml,
  type AndijanMapData,
  type DistrictMapData,
} from './andijan-map-model.js';

const publicData = JSON.parse(
  readFileSync(new URL('../public/andijon-map/data.json', import.meta.url), 'utf8'),
) as AndijanMapData;
const publicDistricts = JSON.parse(
  readFileSync(new URL('../public/andijon-map/districts.json', import.meta.url), 'utf8'),
) as DistrictMapData;
const publicStats = JSON.parse(
  readFileSync(new URL('../public/andijon-map/stats.json', import.meta.url), 'utf8'),
);

test('Andijan map retains the source panes, point symbols, and all source layers', () => {
  assert.deepEqual(ANDIJAN_PANES, {
    img: 250,
    poly: 405,
    osm: 410,
    kmz: 415,
    off: 425,
    pilot: 435,
    pt: 440,
  });
  assert.equal(ANDIJAN_LAYERS.length, 22);
  assert.equal(ANDIJAN_POINT_TYPES.well[0], "Kuzatuv qudug'i");
  assert.deepEqual(
    ANDIJAN_LAYERS.find((layer) => layer.id === 'kmz_canals'),
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
  );
  assert.deepEqual(styleOf(ANDIJAN_LAYERS[0]!, {}), {
    color: '#be185d',
    weight: 4,
    fillColor: '#fb7185',
    fillOpacity: 0.16,
  });
  assert.deepEqual(styleOf(ANDIJAN_LAYERS[4]!, { t: 'well' }), {
    radius: 5,
    color: '#fff',
    weight: 1.5,
    fillColor: '#16a34a',
    fillOpacity: 0.95,
  });
});

test('extracted data keeps the published source counts and the pilot deduplication', () => {
  assert.equal(publicData.quduq?.features.length, 1_999);
  assert.equal(publicData.kollektor_xa?.features.length, 829);
  assert.equal(Object.keys(publicDistricts).length, 14);
  // The source has 398 contours; source id 133 is represented by the separate pilot layer.
  assert.equal(
    (publicData.kmz_canals?.features.length ?? 0) + (publicData.pilot?.features.length ?? 0),
    398,
  );
  // README's 377 includes the contour represented here by the separate pilot layer.
  assert.equal(
    publicData.kmz_canals?.features.filter((feature) => feature.geometry?.type === 'LineString')
      .length,
    376,
  );
});

test('district selection uses the supplied pre-clipped collection and restores the complete collection', () => {
  const district = "Ulug'nor tumani";
  const clipped = districtData(publicData, publicDistricts, district);
  assert.strictEqual(clipped, publicDistricts[district]);
  assert.equal(clipped.tuman?.features.length, 1);
  assert.equal(clipped.quduq?.features.length, 163);
  assert.ok((clipped.quduq?.features.length ?? 0) < (publicData.quduq?.features.length ?? 0));
  assert.strictEqual(districtData(publicData, publicDistricts, null), publicData);
});

test('search groups source parts, ranks the pilot first, and leaves the result count available before UI slicing', () => {
  const rows = buildSearchRows(publicData);
  assert.equal(rows[0]?.layerId, 'pilot');
  const results = searchRows(rows, 'kanal');
  assert.ok(results.length > 40);
  assert.equal(searchRows(rows, 'kanal', 40).length, 40);
  const pilot = searchRows(rows, 'fayzobod')[0];
  assert.equal(pilot?.layerId, 'pilot');
  assert.equal(searchRows(rows, '').length, 0);
});

test('click fallback preserves unnamed, non-searchable source features and numbered source objects', () => {
  const ich = ANDIJAN_LAYERS.find((layer) => layer.id === 'ich')!;
  const adir = ANDIJAN_LAYERS.find((layer) => layer.id === 'adir')!;
  const unnamed = rowForFeature(ich, {
    type: 'Feature',
    id: 'ich-1',
    properties: { len: 1_250, district: 'Asaka tumani' },
    geometry: { type: 'LineString', coordinates: [] },
  });
  assert.equal(unnamed.name, "Xo'jalik ichi kanal (Shp)");
  assert.equal(unnamed.size, '1,3 km');
  assert.equal(unnamed.parts, 1);
  const numbered = rowForFeature(adir, {
    type: 'Feature',
    properties: { no: 7, area_km2: 0.25 },
    geometry: { type: 'Polygon', coordinates: [] },
  });
  assert.equal(numbered.name, '№ 7');
  assert.equal(numbered.size, '25 ga');
  assert.equal(numbered.kind, 'Adir yer');
});

test('source formatting, tooltip content, and statistics preserve Uzbek units and caveats', () => {
  assert.equal(formatKilometres(11_100), '11,1 km');
  assert.equal(formatArea(950), '950 m²');
  assert.equal(formatArea(4_950), '0,5 ga');
  assert.equal(formatArea(1_110_000), '1,11 km²');
  const pilot = ANDIJAN_LAYERS[0]!;
  assert.match(
    tooltipHtml(pilot, { name: 'Fayzobod', area: 4_950, doc_len_m: 11_100 }),
    /Hujjatdagi kanal uzunligi: 11,1 km/,
  );
  assert.match(
    tooltipHtml(ANDIJAN_LAYERS[13]!, { name: 'Test', src: 'itb' }),
    /taxminiy joylashuv/,
  );
  const all = calculateStatistics(publicData, publicStats, null);
  assert.equal(all.rows.length, 14);
  assert.equal(all.totals.wells, 1_999);
  const selected = calculateStatistics(
    publicDistricts["Ulug'nor tumani"]!,
    publicStats,
    "Ulug'nor tumani",
  );
  assert.deepEqual(selected.totals.wells, 163);
});

test('lazy data loading is shared and clears its cache after a failed request for retry', async () => {
  resetAndijanMapDataCache();
  let calls = 0;
  const successful = async () => ({ ok: true, json: async () => ({}) });
  const cachedFirst = loadAndijanMapData(async () => {
    calls += 1;
    return successful();
  });
  const cachedSecond = loadAndijanMapData(async () => {
    calls += 1;
    return successful();
  });
  assert.strictEqual(cachedFirst, cachedSecond);
  await cachedFirst;
  assert.equal(calls, 4);
  resetAndijanMapDataCache();
  await assert.rejects(loadAndijanMapData(async () => ({ ok: false, json: async () => ({}) })));
  await loadAndijanMapData(async () => successful());
  resetAndijanMapDataCache();
});
