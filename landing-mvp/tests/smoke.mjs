import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const [html, base, story, sections, responsive, js] = await Promise.all([
  readFile(resolve(root, 'index.html'), 'utf8'),
  readFile(resolve(root, 'base.css'), 'utf8'),
  readFile(resolve(root, 'story.css'), 'utf8'),
  readFile(resolve(root, 'sections.css'), 'utf8'),
  readFile(resolve(root, 'responsive.css'), 'utf8'),
  readFile(resolve(root, 'app.js'), 'utf8')
]);
const css = base + story + sections + responsive;
const checks = [
  ['has semantic main', html.includes('<main id="main">')],
  ['has scroll story', html.includes('class="story"')],
  ['has network SVG', html.includes('class="network__svg"')],
  ['has dashboard preview', html.includes('id="dashboard"')],
  ['has alarm lifecycle scene', html.includes('id="alarmCard"')],
  ['labels synthetic MVP', html.includes('Synthetic telemetry only')],
  ['has reduced motion CSS', css.includes('@media (prefers-reduced-motion: reduce)')],
  ['uses transform based motion', js.includes('translate3d') && js.includes('requestAnimationFrame')],
  ['keeps stage/discharge/volume units explicit', html.includes('m³/s') && html.includes('m³')],
  ['has motion toggle', html.includes('id="motionToggle"') && js.includes('setMotionState')]
];
const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
if (failed.length) process.exit(1);
console.log(`\n${checks.length}/${checks.length} smoke checks passed.`);
