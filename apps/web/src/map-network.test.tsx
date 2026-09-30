import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { translations } from '@isuv/i18n';
import type { MapNetworkResponse } from '@isuv/contracts';
import { Geometry, StatusLegend } from './map-network.js';
import { joinProvenance } from './provenance-text.js';

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
    'map-conventional-signs',
    'WorkspaceHeader',
    'presentationTimestamp',
    'formatMeasurementValue',
    'measurementUnitLabel',
    'map-station-hatch',
    'map-topology-node-hatch',
    'mapCoordinateGroup',
    'projectTopologyPoint',
    'vectorEffect="non-scaling-stroke"',
    'map-health--abnormal',
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
    'heading={false}',
    "if (selection.stationId) setDetail('network')",
  ])
    assert.ok(source.includes(marker), marker);
  assert.doesNotMatch(source, /network-topology-3d\.jpg|3D Digital Twin/);
  for (const locale of ['uz', 'ru', 'en'] as const) {
    assert.ok(translations[locale].mapGeographicAria.length > 0);
    assert.ok(translations[locale].mapTopologyAria.length > 0);
  }
});

test('map provenance joins API fragments with one readable separator', () => {
  assert.equal(
    joinProvenance(['Synthetic telemetry.', 'synthetic: deterministic live rows']),
    'Synthetic telemetry; synthetic: deterministic live rows',
  );
  assert.equal(joinProvenance(['Source', '; fixture']), 'Source; fixture');
});

test('multi-line waterways retain their supplied components without an invented connector', () => {
  const response: MapNetworkResponse = {
    referenceAt: '2026-08-24T00:00:00Z',
    knownAt: '2026-08-24T00:00:00Z',
    scenario: {
      kind: 'synthetic_scenario',
      label: 'Synthetic map',
      provenance: 'Test fixture',
      official: false,
    },
    detail: 'network',
    scope: { stationCount: 0, deviceCount: 0 },
    overview: [],
    panel: null,
    layers: {
      waterways: [
        {
          id: 'waterway',
          geometry: {
            type: 'MultiLineString',
            coordinates: [
              [
                [69, 40],
                [70, 40],
              ],
              [
                [69, 41],
                [70, 41],
              ],
            ],
          },
        },
      ],
      sections: [],
      junctions: [],
      stations: [],
    },
  };
  const markup = renderToStaticMarkup(
    <Geometry
      locale="en"
      response={response}
      selection={{ stationId: null, deviceId: null }}
      trace={null}
      layers={{ waterways: true, sections: true, junctions: true, stations: true }}
      onSelect={() => undefined}
    />,
  );
  assert.equal([...markup.matchAll(/class="map-waterway"/g)].length, 2);
  assert.doesNotMatch(markup, /20,280 580,280 20,40/);
});

test('operational map projects station and line coordinates onto the same survey sheet', () => {
  const response: MapNetworkResponse = {
    referenceAt: '2026-08-24T00:00:00Z',
    knownAt: '2026-08-24T00:00:00Z',
    scenario: {
      kind: 'synthetic_scenario',
      label: 'Synthetic map',
      provenance: 'Test fixture',
      official: false,
    },
    detail: 'network',
    scope: { stationCount: 1, deviceCount: 1 },
    overview: [],
    panel: null,
    layers: {
      waterways: [
        {
          id: 'waterway',
          geometry: {
            type: 'LineString',
            coordinates: [
              [69, 40],
              [70, 41],
            ],
          },
        },
      ],
      sections: [
        {
          id: 'section',
          upstreamJunctionId: 'junction',
          downstreamJunctionId: null,
          boundary: true,
          geometry: {
            type: 'LineString',
            coordinates: [
              [69, 40],
              [70, 41],
            ],
          },
        },
      ],
      junctions: [{ id: 'junction', geometry: { type: 'Point', coordinates: [69.5, 40.5] } }],
      stations: [
        {
          id: 'station',
          deviceId: 'device',
          junctionId: 'junction',
          geometry: { type: 'Point', coordinates: [69.5, 40.5] },
        },
      ],
    },
  };
  const markup = renderToStaticMarkup(
    <Geometry
      locale="en"
      response={response}
      selection={{ stationId: null, deviceId: null }}
      trace={null}
      layers={{ waterways: true, sections: true, junctions: true, stations: true }}
      onSelect={() => undefined}
    />,
  );
  assert.equal([...markup.matchAll(/points="20,280 580,40"/g)].length, 2);
  assert.match(markup, /class="map-station" cx="300" cy="160"/);
  assert.match(markup, /class="map-junction" cx="300" cy="160"/);
  assert.match(markup, /station: Not available/);
  assert.doesNotMatch(markup, /map-status--reported/);
  const selected = renderToStaticMarkup(
    <Geometry
      locale="en"
      response={response}
      selection={{ stationId: 'station', deviceId: 'device' }}
      stationCodes={{ station: 'SYN-STATION-01' }}
      trace={null}
      layers={{ waterways: true, sections: true, junctions: true, stations: true }}
      onSelect={() => undefined}
    />,
  );
  assert.match(selected, /class="map-station-label"[^>]*><tspan>SYN-STATION-01<\/tspan>/);
  assert.match(selected, /aria-pressed="true"/);
  assert.match(selected, /map-station--selected/);
  assert.match(selected, /Not available/);
  assert.match(selected, /viewBox="0 0 600 300" preserveAspectRatio="xMidYMid meet"/);
});
