/**
 * Checks that the TypeScript port retains the supplied Leaflet definitions and
 * that committed static data retains its source feature counts. This script
 * never evaluates the supplied source bundle; it only lexes its literals.
 *
 * Run: pnpm exec tsx scripts/check-andijan-map-fidelity.mjs
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceFile = path.join(root, 'tmp', 'andijon-source', 'index.html');
const templateFile = path.join(root, 'tmp', 'andijon-source', 'template.html');
const suppliedOverlayDirectory = path.join(root, 'tmp', 'andijon-source', 'overlays');
const staticRoot = path.join(root, 'apps', 'web', 'public', 'andijon-map');
const layerFields = [
  'id',
  'g',
  'key',
  'label',
  'type',
  'color',
  'fill',
  'fillOpacity',
  'w',
  'dash',
  'kind',
  'pane',
  'list',
  'off',
  'chips',
  'nofill',
  'colors',
];

function balanced(source, marker, opener, closer) {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Missing ${marker}`);
  const open = source.indexOf(opener, start + marker.length);
  if (open < 0) throw new Error(`Missing ${opener} after ${marker}`);
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (character === '\n') lineComment = false;
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === opener) depth += 1;
    if (character === closer && --depth === 0) return source.slice(open, index + 1);
  }
  throw new Error(`Unterminated ${marker}`);
}

function topLevelObjects(arrayLiteral) {
  const objects = [];
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let start = -1;
  for (let index = 1; index < arrayLiteral.length - 1; index += 1) {
    const character = arrayLiteral[index];
    const next = arrayLiteral[index + 1];
    if (lineComment) {
      if (character === '\n') lineComment = false;
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '{') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === '}' && --depth === 0) {
      objects.push(arrayLiteral.slice(start, index + 1));
    }
  }
  return objects;
}

function literalValue(objectLiteral, name) {
  const matcher = new RegExp(`(?:^|[,{\\s])${name}\\s*:`);
  const match = matcher.exec(objectLiteral);
  if (!match) return undefined;
  let index = match.index + match[0].length;
  while (/\s/u.test(objectLiteral[index])) index += 1;
  const first = objectLiteral[index];
  if (first === '"' || first === "'") {
    let escaped = false;
    for (let end = index + 1; end < objectLiteral.length; end += 1) {
      const character = objectLiteral[end];
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === first)
        return objectLiteral.slice(index + 1, end).replace(/\\(['"\\])/gu, '$1');
    }
  }
  if (first === '{') {
    const raw = balanced(objectLiteral.slice(index), '', '{', '}');
    return Object.fromEntries(
      [...raw.matchAll(/(['"])(.*?)\1\s*:\s*(['"])(.*?)\3/gu)].map(([, , key, , value]) => [
        key,
        value,
      ]),
    );
  }
  const end = objectLiteral.slice(index).search(/[,}]/u);
  const raw = objectLiteral.slice(index, end < 0 ? undefined : index + end).trim();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'undefined') return undefined;
  return Number(raw);
}

function sourceLayers(source) {
  const literal = balanced(source, 'const LAYERS =', '[', ']');
  return topLevelObjects(literal).map((objectLiteral) =>
    Object.fromEntries(
      layerFields.flatMap((field) => {
        const value = literalValue(objectLiteral, field);
        return value === undefined ? [] : [[field, value]];
      }),
    ),
  );
}

function sourcePanes(source) {
  const literal = balanced(source, 'const PANES =', '{', '}');
  return Object.fromEntries(
    [...literal.matchAll(/(\w+)\s*:\s*(\d+)/gu)].map(([, name, z]) => [name, Number(z)]),
  );
}

function sourcePoints(source) {
  const literal = balanced(source, 'const PT =', '{', '}');
  const decode = (value) => value.replace(/\\(['"\\])/gu, '$1');
  return Object.fromEntries(
    [...literal.matchAll(/(\w+)\s*:\s*\[\s*(['"])(.*?)\2\s*,\s*(['"])(.*?)\4\s*\]/gu)].map(
      ([, id, , label, , color]) => [id, [decode(label), decode(color)]],
    ),
  );
}

function sourceMapData(source, name) {
  const marker = `const ${name} =`;
  return JSON.parse(balanced(source, marker, '{', '}'));
}

async function loadPortedDefinitions() {
  const modelPath = path
    .join(root, 'apps', 'web', 'src', 'andijan-map-model.ts')
    .replaceAll('\\', '/');
  const program = `import { ANDIJAN_LAYERS, ANDIJAN_PANES, ANDIJAN_POINT_TYPES } from ${JSON.stringify(`file:///${modelPath}`)}; console.log(JSON.stringify({ layers: ANDIJAN_LAYERS, panes: ANDIJAN_PANES, points: ANDIJAN_POINT_TYPES }));`;
  return JSON.parse(
    execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', program], {
      cwd: root,
      encoding: 'utf8',
    }).trim(),
  );
}

function comparableLayer(layer) {
  return Object.fromEntries(
    layerFields.flatMap((field) => (layer[field] === undefined ? [] : [[field, layer[field]]])),
  );
}

function servedOverlayMetadata(overlays) {
  return Object.fromEntries(
    Object.entries(overlays).map(([id, overlay]) => [
      id,
      { ...overlay, file: `/andijon-map/overlays/${path.basename(overlay.file)}` },
    ]),
  );
}

async function pngHashes(directory) {
  const files = (await readdir(directory))
    .filter((file) => file.toLowerCase().endsWith('.png'))
    .sort();
  return Object.fromEntries(
    await Promise.all(
      files.map(async (file) => {
        const contents = await readFile(path.join(directory, file));
        return [file, createHash('sha256').update(contents).digest('hex')];
      }),
    ),
  );
}

function compare(expected, actual, label) {
  const expectedJson = JSON.stringify(expected);
  const actualJson = JSON.stringify(actual);
  if (expectedJson !== actualJson) {
    if (Array.isArray(expected) && Array.isArray(actual)) {
      if (expected.length !== actual.length) {
        throw new Error(
          `${label} length differs from the supplied map source: expected ${expected.length}; received ${actual.length}`,
        );
      }
      const index = expected.findIndex(
        (value, item) => JSON.stringify(value) !== JSON.stringify(actual[item]),
      );
      throw new Error(
        `${label} differs from the supplied map source at index ${index}: expected ${JSON.stringify(expected[index])}; received ${JSON.stringify(actual[index])}`,
      );
    }
    throw new Error(
      `${label} differs from the supplied map source: expected ${expectedJson}; received ${actualJson}`,
    );
  }
}

async function main() {
  const [source, template] = await Promise.all([
    readFile(sourceFile, 'utf8'),
    readFile(templateFile, 'utf8'),
  ]);
  const [
    sourceData,
    sourceDistricts,
    sourceOverlays,
    sourceStats,
    data,
    districts,
    overlays,
    stats,
    suppliedHashes,
    servedHashes,
  ] = await Promise.all([
    Promise.resolve(sourceMapData(source, 'DATA')),
    Promise.resolve(sourceMapData(source, 'DISTRICT_DATA')),
    Promise.resolve(sourceMapData(source, 'OVERLAYS')),
    Promise.resolve(sourceMapData(source, 'STATS')),
    readFile(path.join(staticRoot, 'data.json'), 'utf8').then(JSON.parse),
    readFile(path.join(staticRoot, 'districts.json'), 'utf8').then(JSON.parse),
    readFile(path.join(staticRoot, 'overlays.json'), 'utf8').then(JSON.parse),
    readFile(path.join(staticRoot, 'stats.json'), 'utf8').then(JSON.parse),
    pngHashes(suppliedOverlayDirectory),
    pngHashes(path.join(staticRoot, 'overlays')),
  ]);
  const ported = await loadPortedDefinitions();
  const expectedLayers = sourceLayers(source);
  const actualLayers = ported.layers.map(comparableLayer);
  compare(expectedLayers, actualLayers, 'Layer definitions');
  compare(sourcePanes(source), ported.panes, 'Pane z-index definitions');
  compare(sourcePoints(source), ported.points, 'Point type definitions');
  compare(
    sourceLayers(template),
    sourceLayers(source),
    'template.html and index.html layer definitions',
  );
  compare(
    sourcePanes(template),
    sourcePanes(source),
    'template.html and index.html pane definitions',
  );
  compare(
    sourcePoints(template),
    sourcePoints(source),
    'template.html and index.html point definitions',
  );
  compare(sourceData, data, 'Static geometry and feature metadata');
  compare(sourceDistricts, districts, 'District-clipped geometry and feature metadata');
  compare(
    servedOverlayMetadata(sourceOverlays),
    overlays,
    'Overlay metadata after static-path remap',
  );
  compare(sourceStats, stats, 'Statistics data');
  compare(suppliedHashes, servedHashes, 'Supplied overlay PNG bytes');

  const counts = Object.fromEntries(
    Object.entries(sourceData).map(([id, collection]) => [id, collection.features?.length ?? 0]),
  );
  compare(
    counts,
    Object.fromEntries(
      Object.entries(data).map(([id, collection]) => [id, collection.features?.length ?? 0]),
    ),
    'Static feature counts',
  );
  if (
    counts.quduq !== 1999 ||
    counts.kollektor_xa !== 829 ||
    counts.kmz_canals !== 397 ||
    Object.keys(districts).length !== 14
  ) {
    throw new Error('Published source totals do not match expected Andijon-map counts');
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        layers: expectedLayers.length,
        districts: Object.keys(districts).length,
        overlayPngs: Object.keys(servedHashes).length,
        counts,
        note: 'kmz_canals is 397 because the source omits duplicate Fayzobod source_id=133 and exposes it as pilot.',
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
