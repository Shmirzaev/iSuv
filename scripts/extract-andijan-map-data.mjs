/**
 * Extract the four JSON literals embedded in the supplied Andijon map bundle.
 *
 * This deliberately does not evaluate the source bundle. It balances JavaScript
 * braces while respecting quoted strings, then accepts only JSON through
 * JSON.parse. Run from the repository root:
 *
 *   node scripts/extract-andijan-map-data.mjs
 */
import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(repoRoot, 'tmp', 'andijon-source');
const sourceBundle = path.join(sourceRoot, 'index.html');
const destination = path.join(repoRoot, 'apps', 'web', 'public', 'andijon-map');

function extractJsonLiteral(source, name) {
  const declaration = `const ${name} = `;
  const start = source.indexOf(declaration);
  if (start < 0) throw new Error(`Could not find ${declaration}`);
  const open = start + declaration.length;
  if (source[open] !== '{') throw new Error(`${name} is not an object literal`);

  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"') {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return JSON.parse(source.slice(open, index + 1));
    }
  }
  throw new Error(`Unterminated ${name} literal`);
}

function sourceNotes(readme, version) {
  return `# Andijan water-network map sources\n\n## Provenance and handling\n\nThe Andijan water-network data below was supplied in \`tmp/andijon-source\` at source commit recorded in VERSION.txt. It is committed to this repository only by the user's explicit decision. The source marks both code and data confidential and says not to publish them. Geometry and source accuracy caveats remain those of the supplier; the map is reference geometry and provides no live readings.\n\nThe data files at \`apps/web/public/andijon-map/\` are extracted by \`scripts/extract-andijan-map-data.mjs\`. The script reads the self-contained \`index.html\` without evaluating it, parses its four JSON literals, remaps overlay paths for static serving, and copies the supplied PNG overlays.\n\n## README.md (verbatim)\n\n${readme}\n## VERSION.txt (verbatim)\n\n${version}`;
}

async function main() {
  const source = await readFile(sourceBundle, 'utf8');
  const [data, districts, overlays, stats] = ['DATA', 'DISTRICT_DATA', 'OVERLAYS', 'STATS'].map(
    (name) => extractJsonLiteral(source, name),
  );

  await mkdir(destination, { recursive: true });
  const rewrittenOverlays = Object.fromEntries(
    Object.entries(overlays).map(([id, overlay]) => [
      id,
      { ...overlay, file: `/andijon-map/overlays/${path.basename(overlay.file)}` },
    ]),
  );
  await Promise.all([
    writeFile(path.join(destination, 'data.json'), JSON.stringify(data)),
    writeFile(path.join(destination, 'districts.json'), JSON.stringify(districts)),
    writeFile(path.join(destination, 'overlays.json'), JSON.stringify(rewrittenOverlays)),
    writeFile(path.join(destination, 'stats.json'), JSON.stringify(stats)),
  ]);
  const overlayDestination = path.join(destination, 'overlays');
  await mkdir(overlayDestination, { recursive: true });
  const sourceOverlays = await readdir(path.join(sourceRoot, 'overlays'));
  await Promise.all(
    sourceOverlays
      .filter((file) => file.toLowerCase().endsWith('.png'))
      .map((file) =>
        cp(path.join(sourceRoot, 'overlays', file), path.join(overlayDestination, file)),
      ),
  );

  const [readme, version] = await Promise.all([
    readFile(path.join(sourceRoot, 'README.md'), 'utf8'),
    readFile(path.join(sourceRoot, 'VERSION.txt'), 'utf8'),
  ]);
  await writeFile(
    path.join(repoRoot, 'docs', 'ANDIJAN_MAP_SOURCES.md'),
    sourceNotes(readme, version),
  );

  const counts = Object.fromEntries(
    Object.entries(data).map(([id, collection]) => [id, collection?.features?.length ?? 0]),
  );
  const kmzCenterlines = data.kmz_canals.features.filter(
    (feature) => feature.geometry?.type === 'LineString',
  ).length;
  const expected = {
    quduq: 1999,
    kollektor_xa: 829,
    kmz_canals: 397,
    districts: 14,
    kmzCenterlinesWithPilot: 377,
  };
  const actual = {
    quduq: counts.quduq,
    kollektor_xa: counts.kollektor_xa,
    kmz_canals: counts.kmz_canals,
    districts: Object.keys(districts).length,
    kmzCenterlinesWithPilot: kmzCenterlines + data.pilot.features.length,
  };
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error(`Unexpected source totals: ${JSON.stringify(actual)}`);
  }
  const outputFiles = await Promise.all(
    ['data.json', 'districts.json', 'overlays.json', 'stats.json'].map(async (file) => {
      const fileStat = await stat(path.join(destination, file));
      return [file, fileStat.size];
    }),
  );
  console.log(
    JSON.stringify(
      {
        counts,
        districts: Object.keys(districts).length,
        overlays: Object.keys(overlays).length,
        kmzCenterlines,
        expected,
        files: Object.fromEntries(outputFiles),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
