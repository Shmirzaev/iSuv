import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { translations } from '@isuv/i18n';
import { StatusLegend } from './map-network.js';

test('map legend presents every compliance and data state with icon, localized text, and explanatory value', () => {
  for (const locale of ['uz', 'ru', 'en'] as const) {
    const markup = renderToStaticMarkup(<StatusLegend locale={locale} />);
    for (const key of [
      'statusOver',
      'statusOnPlan',
      'statusUnder',
      'noData',
      'statusUnreliable',
    ] as const)
      assert.match(markup, new RegExp(translations[locale][key]));
    assert.match(markup, new RegExp(translations[locale].mapComplianceUnconfigured));
  }
});

test('coordinated topology, governed placeholders, timestamps, and localized accessible names remain in the map renderer', async () => {
  const source = await readFile(new URL('./map-network.tsx', import.meta.url), 'utf8');
  for (const marker of [
    'map-topology-svg',
    'map-section--trace',
    'map-topology-node--selected',
    'mapTargetDischarge',
    'deliveredVolume',
    'plannedVolume',
    'liveVariance',
    'mapDuration',
    'systemConfidence',
    'unexplainedBalance',
    'mapObservedAt',
    'mapIngestedAt',
    'mapGeographicAria',
    'mapTopologyAria',
    'map-topology-paths',
    'map-workspace__toolbar',
    'WorkspaceHeader',
    'presentationTimestamp',
    'map-workspace',
    'map-canvas',
    'map-sidebar',
    'map-sidebar__details',
    "role={selectable ? 'button' : undefined}",
    "event.key === 'Enter' || event.key === ' '",
    'onSelect={select}',
    "initialMapDetail(selection) : 'network'",
    'stations: true',
    'checked={layers[x]}',
    'value.reason',
    'HealthStatus',
    "if (selection.stationId) setDetail('network')",
  ])
    assert.ok(source.includes(marker), marker);
  for (const locale of ['uz', 'ru', 'en'] as const) {
    assert.ok(translations[locale].mapGeographicAria.length > 0);
    assert.ok(translations[locale].mapTopologyAria.length > 0);
  }
});
