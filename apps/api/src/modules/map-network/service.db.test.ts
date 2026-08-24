import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import {
  mapNetworkResponseSchema,
  playbackResponseSchema,
  traceResponseSchema,
} from '@isuv/contracts';
import { Pool } from 'pg';
import { PostgresMapNetworkService } from './service.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const pool = new Pool({ connectionString: databaseUrl });
after(async () => pool.end());

const national = 'a2000000-0000-4000-8000-000000000001';
const districtA = 'a2000000-0000-4000-8000-000000000004';
const systemAdministrator = 'a3000000-0000-4000-8000-000000000001';
const organization = 'a1000000-0000-4000-8000-000000000001';

test('map composes scoped progressive geometry, directed traces, and paused stage playback', async () => {
  const service = new PostgresMapNetworkService(databaseUrl);
  assert.equal(
    await service.findDefaultTerritory(
      systemAdministrator,
      organization,
      new Date('2026-08-23T00:00:00.000Z'),
    ),
    national,
  );
  const overview = await service.map(national, { detail: 'overview' });
  assert.ok(overview);
  mapNetworkResponseSchema.parse(overview);
  assert.equal(overview.scope.stationCount, 83);
  assert.equal(overview.scope.deviceCount, 83);
  assert.equal(overview.overview.length, 5);
  assert.equal(
    overview.overview.reduce((sum, basin) => sum + basin.stationCount, 0),
    83,
  );
  assert.deepEqual(overview.layers, { waterways: [], junctions: [], sections: [], stations: [] });

  const basin = await service.map(national, { detail: 'basin' });
  assert.ok(basin);
  assert.ok(basin.layers.waterways.length >= 5);
  assert.equal(basin.layers.junctions.length, 0);
  assert.equal(basin.layers.stations.length, 0);

  const network = await service.map(national, { detail: 'network' });
  assert.ok(network);
  mapNetworkResponseSchema.parse(network);
  assert.equal(network.layers.stations.length, 83);
  assert.ok(network.layers.junctions.length > network.layers.stations.length);
  assert.ok(network.layers.sections.length > network.layers.stations.length);
  assert.ok(
    network.layers.stations.every(
      (station) =>
        station.geometry.coordinates[0] >= -180 &&
        station.geometry.coordinates[0] <= 180 &&
        station.geometry.coordinates[1] >= -90 &&
        station.geometry.coordinates[1] <= 90,
    ),
  );

  const selected = network.layers.stations[0]!;
  const drilled = await service.map(national, { detail: 'network', stationId: selected.id });
  assert.ok(drilled?.panel);
  assert.deepEqual(
    [drilled.panel.stage.unit, drilled.panel.discharge.unit, drilled.panel.counter.unit],
    ['m', 'm3/s', 'm3'],
  );
  assert.equal(drilled.panel.targetDischarge.state, 'unconfigured');
  assert.equal(drilled.panel.deliveredVolume.state, 'unconfigured');
  assert.equal(drilled.panel.health.power.unit, 'V');
  assert.equal(drilled.panel.health.signal.unit, 'dBm');
  assert.equal(drilled.panel.stage.source.official, false);

  const downstream = await service.trace(national, selected.id, 'downstream');
  assert.ok(downstream);
  traceResponseSchema.parse(downstream);
  assert.ok(downstream.edges.length > 1);
  assert.ok(
    [...new Map(downstream.edges.filter((edge) => edge.to).map((edge) => [edge.to!, 0])).keys()]
      .length > 0,
  );
  assert.ok(downstream.disclaimer.includes('Directed topology'));

  const playback = await service.playback(national, selected.id);
  assert.ok(playback);
  playbackResponseSchema.parse(playback);
  assert.equal(playback.paused, true);
  assert.equal(playback.unit, 'm');
  assert.ok(
    playback.frames.some((frame) => frame.gap && frame.raw === null && frame.validated === null),
  );
  assert.ok(playback.frames.every((frame) => frame.source.official === false));

  const scoped = await service.map(districtA, { detail: 'network' });
  assert.ok(scoped);
  assert.ok(scoped.scope.stationCount > 0 && scoped.scope.stationCount < 83);
  const hidden = network.layers.stations.find(
    (station) => !scoped.layers.stations.some((visible) => visible.id === station.id),
  );
  assert.ok(hidden);
  assert.equal(
    (await service.map(districtA, { detail: 'network', stationId: hidden.id }))?.panel,
    null,
  );
  assert.equal(await service.trace(districtA, hidden.id, 'downstream'), null);
  assert.equal(await service.playback(districtA, hidden.id), null);

  const visibleJunctionIds = new Set(scoped.layers.junctions.map((junction) => junction.id));
  const scopedStart = scoped.layers.stations[0]!;
  const scopedTrace = await service.trace(districtA, scopedStart.id, 'downstream');
  assert.ok(scopedTrace);
  assert.ok(scopedTrace.nodes.every((node) => visibleJunctionIds.has(node)));
  for (const edge of scopedTrace.edges.filter((edge) => edge.boundary)) {
    assert.ok(edge.from === null || visibleJunctionIds.has(edge.from));
    assert.ok(edge.to === null || visibleJunctionIds.has(edge.to));
    assert.ok(edge.from === null || edge.to === null);
  }

  const junctionGeometry = new Map(
    scoped.layers.junctions.map((junction) => [junction.id, junction.geometry.coordinates]),
  );
  const boundarySections = scoped.layers.sections.filter((candidate) => candidate.boundary);
  assert.ok(boundarySections.length > 0, 'the district fixture must exercise a scope boundary');
  for (const section of boundarySections) {
    const visibleId = section.upstreamJunctionId ?? section.downstreamJunctionId;
    assert.ok(visibleId);
    const visiblePoint = junctionGeometry.get(visibleId);
    assert.ok(visiblePoint);
    assert.deepEqual(
      section.geometry.coordinates,
      [visiblePoint, visiblePoint],
      'cross-boundary geometry must not expose the foreign endpoint location',
    );
  }
  const hiddenBoundaryPoint = await pool.query<{ x: number; y: number }>(
    `WITH RECURSIVE scope AS (
       SELECT id FROM territories WHERE id = $1
       UNION ALL
       SELECT child.id
       FROM territories child
       JOIN scope parent ON child.parent_territory_id = parent.id
     )
     SELECT ST_X(hidden.geometry)::float8 AS x, ST_Y(hidden.geometry)::float8 AS y
     FROM water_sections section
     JOIN network_junctions upstream ON upstream.id = section.upstream_junction_id
     JOIN network_junctions downstream ON downstream.id = section.downstream_junction_id
     JOIN network_junctions hidden ON hidden.id = CASE
       WHEN upstream.territory_id IN (SELECT id FROM scope) THEN downstream.id
       ELSE upstream.id
     END
     WHERE section.territory_id IN (SELECT id FROM scope)
       AND (
         (upstream.territory_id IN (SELECT id FROM scope))
         <> (downstream.territory_id IN (SELECT id FROM scope))
       )
     LIMIT 1`,
    [districtA],
  );
  assert.ok(hiddenBoundaryPoint.rows[0], 'the district fixture must have a hidden endpoint');
  const hiddenCoordinate = [hiddenBoundaryPoint.rows[0].x, hiddenBoundaryPoint.rows[0].y];
  assert.ok(
    scoped.layers.waterways.every((waterway) =>
      (waterway.geometry.type === 'LineString'
        ? waterway.geometry.coordinates
        : waterway.geometry.coordinates.flat()
      ).every(
        (coordinate) =>
          coordinate[0] !== hiddenCoordinate[0] || coordinate[1] !== hiddenCoordinate[1],
      ),
    ),
    'scoped waterway geometry must not expose a foreign boundary endpoint',
  );
  const scopedWaterwayComponents = scoped.layers.waterways.reduce(
    (count, waterway) =>
      count + (waterway.geometry.type === 'LineString' ? 1 : waterway.geometry.coordinates.length),
    0,
  );
  const scopedWaterwaySectionComponents = await pool.query<{ count: number }>(
    `WITH RECURSIVE scope AS (
       SELECT id FROM territories WHERE id = $1
       UNION ALL
       SELECT child.id
       FROM territories child
       JOIN scope parent ON child.parent_territory_id = parent.id
     ), clipped AS (
       SELECT section.waterway_id,
              CASE
                WHEN upstream.territory_id IN (SELECT id FROM scope)
                 AND downstream.territory_id IN (SELECT id FROM scope)
                  THEN section.geometry
                WHEN upstream.territory_id IN (SELECT id FROM scope)
                  THEN ST_MakeLine(upstream.geometry, upstream.geometry)
                ELSE ST_MakeLine(downstream.geometry, downstream.geometry)
              END AS geometry
       FROM water_sections section
       JOIN network_junctions upstream ON upstream.id = section.upstream_junction_id
       JOIN network_junctions downstream ON downstream.id = section.downstream_junction_id
       WHERE section.territory_id IN (SELECT id FROM scope)
         AND (
           upstream.territory_id IN (SELECT id FROM scope)
           OR downstream.territory_id IN (SELECT id FROM scope)
         )
     ), merged AS (
       SELECT waterway_id, ST_Collect(geometry) AS geometry
       FROM clipped
       GROUP BY waterway_id
     )
     SELECT sum(ST_NumGeometries(geometry))::int AS count FROM merged`,
    [districtA],
  );
  assert.equal(
    scopedWaterwayComponents,
    scopedWaterwaySectionComponents.rows[0]?.count,
    'every scoped merged waterway component must remain in the response',
  );

  const count = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM live_operations_synthetic_rows WHERE scenario_id='d6000000-0000-4000-8000-000000000001'",
  );
  assert.equal(count.rows[0]?.count, '83');
});
